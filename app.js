// Initialize libraries (quite a lot of them, too!)
var express = require('express')
  , mkdirp = require('mkdirp')
  , _ = require('underscore')
  , fs = require('fs')
  , imageDB = require('./imagedb.js').ImageDB
  , userDB = require('./userdb.js').UserDB
  , cacheDB = require('./cachedb.js').CacheDB
  , im = require('imagemagick')
  , qs = require('querystring')
  , crypto = require('crypto')
  , argv = require('optimist').argv
  , bar = require('progress-bar')
  , async = require('async')
  , redis = require('redis')
  , queryParser = require('./queryparser.js').QueryParser
  , imageHandler = require('./image.js')
  , tempurl = require('./tempurl.js')
  , util = require('./util.js')
  , tagCloud = require('./cloudgen.js');

_.str = require('underscore.string');
_.mixin(_.str.exports());

var app = express();

var defaultConfig = require('./config-default.json')
  , defaultImage = { author: "Unknown", source: "/", uploader: "Computer"}
  , defaultSiteConfig = { subtitle: null, title: "Website", htmlTitle: null, noAjaxLoad: false, mobile: false}
  , templateFunctions = {
    template: function(name) {
      return makeRawTemplate(name,this,true);
    }
  };

// Utility
function error(req,res,text,codeO) {
  var code = codeO || 500;
  if(req.query["mode"] == "json")
    res.send({error: text, errorCode: code});
  else
    res.send(code,text);
}

function parse(req,res,next) { if(req.params[0]) req.params = req.params[0].split("/"); else req.params = [""]; next(); }

// Configure
var config = fs.existsSync("./config.json") ? require('./config.json') : defaultConfig
  , templates = {};

config = _.defaults(config,defaultConfig);
if(!_(config).contains("htmlTitle")) {
  if(_(config).contains("logo")) config.htmlTitle = "<img src='/" + config.logo + "' style='height: auto; width: 300px;'></img>";
  else config.htmlTitle = config.title;
}

_.each(fs.readdirSync("templates/"),function(filename) {
  var name = filename.split(".")[0];
  console.log("[Template] Loading template "+name);
  templates[name] = fs.readFileSync("./templates/"+filename,"utf8");    
});

imageHandler.express(express,app);

// Image Adding
function addImage(rawdata,format,info,callback,thumbnailsrc,grav) {
  var hash = crypto.createHash('md5').update(rawdata).digest('hex');
  imageDB.hashed(hash,function(cont) {
    if(!cont) imageDB.count("imageId",function(err,id) {
      var path = id+"."+format;
      var source = "./img/src/"+path;
      console.log("Writing file " + id);
      fs.writeFile(source,rawdata,"utf8",function() {
        console.log("Identifying file " + id);
        im.identify(source, function(err,features) {
          if(err) throw err;
          var data = { id: id, format: format, filename: path, originalFilename: info.filename,
                       width: features.width, height: features.height, hash: hash, thumbnailGravity: grav || "center"};
          data = _.defaults(data,info);
          delete data.gravity; // Fix for duplicate data
          imageDB.set(id,_.defaults(data,defaultImage));
          imageHandler.handle(thumbnailsrc || source, path, thumbnailsrc?600:features.width,thumbnailsrc?600:features.height,grav,{optimizeSrc: true});
          if(_.isFunction(callback)) callback();
        });
      });
    });  
    else if(_.isFunction(callback)) callback(new Error("File already exists!"));
  });
}

// Templating
function makeRawTemplate(name,conf,noHeader) {
  try {
    var conf2 = _.defaults(conf,config,defaultSiteConfig,defaultConfig,templateFunctions);
    var body = _.template(templates[name],conf2);
    if(!noHeader)
      body = _.template(templates["header"],conf2) + body;
    return body;
  } catch(e) { var s = "RawTemplate error: " + e.message + " ["+name+"]"; console.trace(s); return s; }
}
function makeTemplate(name,conf2,raw,noHeader) {
  if(raw=="raw") return makeRawTemplate(name,conf2,noHeader);
  var conf = _.defaults(conf2,config,defaultSiteConfig,defaultConfig,templateFunctions);
  return _.template(templates["main"],_.defaults(conf,{page: makeRawTemplate(name,conf,noHeader)}));
}

// ** LOGIN HANDLER **
app.use(express.cookieParser(config.salt));
app.use(express.session({key: "booru-user",secret: config.salt}));

function restrict(req,res,next) {
  if(req.session.user) { next(); }
  else { req.session.error = "Access denied!"; error(req,res,"Access denied - log in.",403); }
}
function restrictAdmin(req,res,next) {
  if(req.session.user && req.session.type == "admin") { next(); }
  else { req.session.error = "Access denied!"; error(req,res,"Access denied - log in.",403); }
}
app.get("/logout", function(req,res) {
  req.session.destroy(function(){ res.redirect("/"); });
});
app.post("/login", express.bodyParser(), function(req,res) {
  var encPassword = userDB.hash(req.body.password);
  userDB.exists(req.body.username, function(err, exists) {
    if(exists) {
      userDB.get(req.body.username, function(err, data) {
        if(data.pass == encPassword) {
            req.session.regenerate(function() {
            req.session.user = data.user;
            req.session.type = data.type;
            res.redirect("/");
          });
        } else { error(req, res, "Invalid username or password!", 403); return; }
      });
    } else { error(req, res, "Invalid username or password!", 403); return; }
  });
});
app.get("/login", function(req,res) {
  res.send(makeTemplate("login",{req: req}));
});

// Upload
app.post("/upload/post", express.bodyParser());
app.post("/upload/post", restrict, function(req,res) {
  var thumbnailFilename;
  if(!req.body.uploader)
    { error(req,res,"Missing metadata!"); return; }
  var metadata = req.body;
  metadata.tags = util.tagArray(req.body.tags_string);
  if(req.files && req.files.thumbnail) thumbnailFilename = req.files.thumbnail.path;
  if(!req.files || !req.files.image) {
    if(!req.body.url) { error(req,res,"No file specified!"); return; }
    ext = util.fileExt(req.body.url);
    tempurl.download(req.body.url, function(err, tmpfile, callback){
      if(err) { error(req,res,"Download error!"); return; }
      finishUpload(res, "file."+util.fileExt(tmpfile), thumbnailFilename, tmpfile, metadata, callback);
    });
  } else { finishUpload(res, req.files.image.name, thumbnailFilename, req.files.image.path, metadata); }
});
function finishUpload(res,fn,thfn,path,metadata, next) {
  var ext = util.fileExt(fn);
  fs.readFile(path, function(err, data) {
    if(err) throw err;
    addImage(data,ext,metadata,function(){ error(req,res,"OK",200); if(_.isFunction(next)) next(); },thfn,metadata.gravity);
  });
}
app.get("/upload", restrict, parse, function(req,res,next) {
  res.send(makeTemplate("upload",{req: req, username: req.session.user, useZepto: false},req.params[0]));
});

// Searching
function handleQuery(entry,images,allImages) {
  if(entry.invert) return _(allImages).filter(function(val) {
    return !_(images).contains(val);
  });
  return images;
}
function handleSearch(req, res, query) {
  var stack = [];
  cacheDB.exists("search:"+query,function(err,exists) {
    if(!exists)
      imageDB.images(function(allImages) {
        async.eachSeries(query, function(entry, next) {
          if(entry.type == "tag") {
            imageDB.imagesBy("tag",entry.key,function(images) { stack.push(handleQuery(entry,images,allImages)); next(); });
          } else if(entry.type == "string") {
            imageDB.imagesBy(entry.key,entry.value,function(images) { stack.push(handleQuery(entry,images,allImages)); next(); });
          } else if(entry.type == "numeric") {
            var p = queryParser.handleNumeric(entry.sign, parseInt(entry.value));
            imageDB.imagesByNum(entry.key,p.min,p.max,function(images) { stack.push(images); next(); });
          } else if(entry.type == "linker" && stack.length >= 2) {
            var p1 = stack.pop()
              , p2 = stack.pop();
            stack.push(queryParser.handleLinker(entry.link, p1, p2));
            next();
          } else next();
        }, function() {
          // Done sorting!
          if(stack.length > 1) { error(req,res,"Something quite bad happened! "+JSON.stringify(stack)); return; }
          var result = stack.pop();
          cacheDB.set("search:"+query,result,60,null);
          listImages(req,res,result,req.query,{noAjaxLoad: true, isSearch: true, subtitle: Math.min(1000,result.length)+" results found."},1000);
        });
      });
    else { // Found cached!
      console.log("Loading from cache!");
      cacheDB.get("search:"+query,function(err,result) {
        listImages(req,res,result,req.query,{noAjaxLoad: true, isSearch: true, subtitle: Math.min(1000,result.length)+" results found."},1000);
      });
    }
  });
}
app.post("/search",express.bodyParser(), function(req,res) {
  var query = queryParser.parse(req.body.query);
  console.log(query);
  handleSearch(req, res, query);
});
app.get("/search",express.bodyParser(), function(req,res) {
  var query = queryParser.parse(req.query["q"] || req.query["query"]);
  console.log(query);
  handleSearch(req, res, query);
});

// Editing
app.get("/delete/*", restrictAdmin, parse, function(req,res) {
  console.log("Deleting ID " + req.params[0]);
  imageDB.unset(req.params[0],function(){res.redirect("/");});
});
app.get("/regenerate/*", restrictAdmin, parse, function(req,res) {
  var id = req.params[0];
  console.log("Regenerating ID " + id);
  imageDB.regenerate(id,function(){
    imageDB.get(id,function(image) {
      imageHandler.handle("./img/src/"+image.filename,image.filename,null,null,image.thumbnailGravity,{optimizeSrc: false});
      res.redirect("/");
    });
  });
});
app.post("/edit", express.bodyParser(), restrict, getImagePost, function(req,res) {
  var image = req.image;
  image.name = req.body.name || image.name;
  image.author = req.body.author || image.author;
  image.source = req.body.source || image.source;
  image.thumbnailGravity = req.body.gravity || image.thumbnailGravity;
  image.tags = util.tagArray(req.body.tags_string) || image.tags || [];
  if(req.files && req.files.thumbnail)
    imageHandler.handle(req.files.thumbnail.path,image.filename,null,null,image.thumbnailGravity,{optimizeSrc: false});
  imageDB.set(image.id,image,function() {
    res.redirect("/");
  }, true);
});
app.get("/edit/*", restrict, parse, getImage, function(req,res) {
  res.send(makeTemplate("edit",{image: _.defaults(req.image, defaultImage), req: req},req.params[0]));
});

// Image retrieval
function getImage(req,res,next) {
  imageDB.get(req.params.shift(),function(data) {
    if(data==null) { error(req,res,"Image not found!",404); return; }
    req.image = data;
    next();
  });
}
function getImagePost(req,res,next) {
  imageDB.get(req.body.id,function(data) {
    if(data==null) { error(req,res,"Image not found!",404); return; }
    req.image = data;
    next();
  });
}
app.get("/image/*", parse, getImage, function(req,res) {
  if(req.query["mode"] == "json") {
    res.json(req.image);
  } else res.send(makeTemplate("view",{image: _.defaults(req.image, defaultImage), req: req},req.params[0]));
});
function getImagesTagged(tags,next) {
  if(tags) {
    var imageList = [];
    async.each(tags,function(tag,callback) {
      imageDB.imagesBy("tag",tag, function(images) {
        imageList = _.union(imageList, images);
        callback();
      });
    }, function() { next(imageList); } );
  } else next([]);
}

// Image listing
function listImages(req,res,images1,options,defConfig,maxVal) {
  var start = parseInt(options["start"]) || 0;
  var mode = options["mode"] || "";
  var noHeader = false;
  var images1a, data;
  var maxValue = options["length"] || maxVal || config.pageSize;
  if(maxValue > config.maxPageSize) maxValue = config.maxPageSize;
  getImagesTagged(config.hiddenTags,function(hiddenImages) {
    if(!_(req.cookies.showHidden).isUndefined() || req.query["hidden"] == true) images1a = images1;
    else images1a = _.difference(images1,hiddenImages);
    imageDB.range(images1a,start,maxValue,function(images2) {
      var conf = _.defaults({images: images2, position: start, maxpos: images1.length, req: req}, defConfig || {isSearch: false});
      console.log(options);
      if(options["mobile"] == 'true') conf.mobile = true;
      if(mode=="json") {
        if(config.allowJson == false) { error(req, res, "JSON not allowed!", 403); return; }
        res.json({position: start, length: images2.length, results: images2});
      } else {
        if(_(options).has("subtitle2"))
          conf.subtitle = _.capitalize(options["subtitle1"])+": "+options["subtitle2"];
        else if(!_.isString(conf.subtitle)) { // Create custom subtitle
          if(start > 0 && (start % config.pageSize) == 0) { // page 2+
            conf.subtitle = "Page " + ((start / config.pageSize)+1);
          } else { // page 1
            conf.subtitle = "Now with " + conf.maxpos + " images!";        
          }
        }
        var imagesLi = makeRawTemplate("images-li",conf,"raw",true);
        conf.imagesLi = imagesLi;
        if(mode == "append") data = conf.imagesLi;
        else data = makeTemplate("images",conf,mode,noHeader);
        res.send(data);
      }
    });
  });
}

app.get("/cloud/*", parse, function(req,res) {
  if(req.params.length < 1 || !imageDB.isCloudTag(req.params[0])) { error(req,res,"No tag found!",404); return; }
  imageDB.getCloud(req.params[0], function(cloudData) {  
    console.log(cloudData);
    var cloudTag = tagCloud.generate(cloudData, {});
    var opts = {title: "All "+req.params[0]+"s", tagCloud: cloudTag, req: req};
    res.send(makeTemplate("tagcloud",opts,req.query["mode"] || "",false));
  });
});
app.get("/*", function(req,res) {
  var p = qs.unescape(req.path).split("/");
  console.log("Request: " + JSON.stringify(p)); 
  if(p.length>0 && (p[1] == "tag" || p[1] == "author" || p[1] == "uploader")) imageDB.imagesBy(p[1],p[2],function(images) {
    listImages(req,res,images,_(req.query).extend({"subtitle1": p[1], "subtitle2": p[2]}));
  });
  else imageDB.images(function(images) { listImages(req,res,images,req.query); });
});

// Personal boost.io code
app.get("/mu-d6235ad9-7bb860d1-37dcb55d-226ee30b",function(req,res) {
  res.send("42");
});

// Config validation
if(config.salt == defaultConfig.salt || config.salt.length < 16) {
  if(config.salt.length > 0 && config.salt.length < 16) { console.log("\nWARNING: Your salt is too short (minimum 16 characters)."); }
  console.log("\n!!!!!!! WARNING !!!!!!!\nThe server has been disabled until you change the *encryption salt*.\nChange it to something secure in config.json.");
  process.exit(0);
}

console.log("Connecting to database...")
var client = redis.createClient();
imageDB.connect(client);
cacheDB.connect(client);
userDB.connect(client, config.salt);
imageHandler.setMode(config.optimize);

userDB.exists("admin", function(err, exists) {
  if(!err && !exists) {
    console.log("Creating default users...");
    _.each(config.defaultUsers, function(value,key) {
      console.log("[+] "+key);
      userDB.addUser({user: key, pass: userDB.hash(value), nick: key, type: "admin"});
    });
  }
  else if(err) { console.log("Error checking userDB! " + err.message); }
});

function start() {
  imageDB.updateDatabase(function() {
    app.listen(config.port);
    console.log("Working on port " + config.port);
  });
}

if(argv.r || argv.regen) {
  console.log("Regeneration requested, re-indexing images...");
  imageDB.images(function(images) {
    var bar = require('progress-bar').create(process.stdout,20);
    var i = 0;
    async.eachSeries(images,function(image, callback) {
      imageDB.regenerate(image,function(){
        i+=1; bar.update(i/images.length); callback();
      });
    },function(){
      console.log("\nDone!");
      start();
    });
  });
}
else start();

if(argv.o || argv.opt) {
  console.log("Optimization requested, optimizing all images...");
  imageDB.images(function(images) {
    imageDB.getArray(images, function(err,idata) {
      _(idata).each(function(img) {
        imageHandler.optimize("./img/src/"+img.filename, img);
        imageHandler.optimize("./img/thumb/"+img.filename, img);
        imageHandler.optimize("./img/thumb2x/"+img.filename, img);
      });
    });
  });
}
if(argv.t || argv.thumb) {
  console.log("Thumbnailization requested, re-thumbnailing all images...");
  imageDB.images(function(images) {
    imageDB.getArray(images, function(err,idata) {
      async.eachLimit(idata,config.optimizationThreads || 1,function(image,next) {
        imageHandler.handle("./img/src/"+image.filename,image.filename,null,null,image.thumbnailGravity,{callback: next, optimizeSrc: false});
      });
    });
  });
}

process.on("uncaughtException", function(err) {
  console.log("Uncaught exception! Please report to author");
  console.log(err);
});
