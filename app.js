// Initialize libraries (quite a lot of them, too!)
var express = require('express')
  , mkdirp = require('mkdirp')
  , _ = require('underscore')
  , fs = require('fs')
  , JSON = require('JSON2')
  , imageDB = require('./imagedb.js').ImageDB
  , userDB = require('./userdb.js').UserDB
  , cacheDB = require('./cachedb.js').CacheDB
  , im = require('imagemagick')
  , path = require('path')
  , qs = require('querystring')
  , crypto = require('crypto')
  , argv = require('optimist').argv
  , bar = require('progress-bar')
  , async = require('async')
  , redis = require('redis')
  , queryparser = require('./queryparser.js').QueryParser;

_.str = require('underscore.string');
_.mixin(_.str.exports());

var app = express();

// Configure
var config = require('./config.json')
  , templates = {};

var defaultConfig = { salt: "ICannotIntoSalts", defaultUsers: {"admin": "admin"} }
  , defaultImage = { author: "Unknown", source: "/", uploader: "Computer"}
  , defaultSiteConfig = { subtitle: null, title: "Website", htmlTitle: null, noAjaxLoad: false};

config = _.defaults(config,defaultConfig);

_.each(fs.readdirSync("templates/"),function(filename) {
  var name = filename.split(".")[0];
  console.log("[Template] Loading template "+name);
  templates[name] = fs.readFileSync("templates/"+filename,"utf8");    
});

// File/thumbnail
function fileExt(name) {
  var ext = path.extname(name).split(".");
  return ext[ext.length-1];
}

var thumbW = 300, thumbH = 300;

function resize(src,dest,w,h,cb,grav) {
  var cnf = { srcPath: src, dstPath: dest,
              width: w, height: h+"^", quality: 0.9,
              customArgs: [ "-dispose", 2, "-coalesce", "-gravity", grav || "center", "-extent", w+"x"+h, "-layers", "OptimizePlus"] };
  im.resize(_.defaults(cnf),cb);
}

function copy(src,dest) {
  fs.createReadStream(src).pipe(fs.createWriteStream(dest));
}

function thumbnail(src,dest,dest2x,w,h,grav) {
  console.log("thumbnail called");
  t2 = function() {
    if(_.isString(dest2x) && (w>thumbW || h>thumbH))
      resize(src,dest2x,thumbW*2,thumbH*2,null,grav);
  };
  if(thumbW<w || thumbH<h) resize(src,dest,thumbW,thumbH,t2,grav);
  else { copy(src,dest); t2(); }
}

// AddImage
function addImage(rawdata,format,info,callback,thumbnailsrc,grav) {
  var hash = crypto.createHash('md5').update(rawdata).digest('hex');
  imageDB.hashed(hash,function(cont) {
    if(!cont) imageDB.count("imageId",function(err,id) {
      var path = id+"."+format;
      console.log("Writing file " + id);
      fs.writeFile("img/src/"+path,rawdata,"utf8",function() {
        console.log("Identifying file " + id);
        im.identify("img/src/"+path, function(err,features) {
          if(err) throw err;
          var data = { id: id, format: format, filename: path, originalFilename: info.filename,
                       width: features.width, height: features.height, hash: hash, thumbnailGravity: grav || "center"};
          data = _.defaults(data,info);
          imageDB.set(id,_.defaults(data,defaultImage));
          thumbnail(thumbnailsrc || ("img/src/"+path),"img/thumb/"+path,"img/thumb2x/"+path,thumbnailsrc?600:features.width,thumbnailsrc?600:features.height,grav);
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
    var conf2 = _.defaults(conf,config,defaultSiteConfig);
    var body = _.template(templates[name],conf2);
    if(!noHeader)
      body = _.template(templates["header"],conf2) + body;
    return body;
  } catch(e) { return "Template error: " + e.message; }
}
function makeTemplate(name,conf,raw,noHeader) {
  try {
    if(raw=="raw") return makeRawTemplate(name,conf,noHeader);
    var conf2 = _.defaults(conf,config,defaultSiteConfig);
    return _.template(templates["main"],_.defaults(conf2,{page: makeRawTemplate(name,conf,noHeader)}));
  } catch(e) { return "Template error: " + e.message; }
}

// Tagify string
function tagArray(str) {
  var t = str.split(",");
  t = _.map(t,function(v){return v.trim();});
  console.log(t);
  return t;
}

// Auth code
app.use(express.cookieParser(config.salt));
app.use(express.session({key: "booru-user",secret: config.salt}));

function restrict(req,res,next) {
  if(req.session.user) { next(); }
  else { req.session.error = "Access denied!"; res.send(403,"Access denied - log in."); }
}
function restrictAdmin(req,res,next) {
  if(req.session.user && req.session.type == "admin") { next(); }
  else { req.session.error = "Access denied!"; res.send(403,"Access denied - log in."); }
}
function parse(req,res,next) { if(req.params[0]) req.params = req.params[0].split("/"); else req.params = [""]; next(); }
function getImage(req,res,next) {
  imageDB.get(req.params.shift(),function(data) {
    if(data==null) { res.send(404,"Image not found!"); return; }
    req.image = data;
    next();
  });
}
function getImagePost(req,res,next) {
  imageDB.get(req.body.id,function(data) {
    if(data==null) { res.send(404,"Image not found!"); return; }
    req.image = data;
    next();
  });
}

// Create missing directories (just in case)
mkdirp.sync("img/src");
mkdirp.sync("img/thumb");
mkdirp.sync("img/thumb2x");

// Load directory dependencies
app.use("/static/",express.compress());
app.use("/static/",express.static("bootstrap"));
app.use("/static/",express.static("static"));
app.use("/img/",express.static("img"));
app.use("/img/thumb2x/",express.static("img/thumb"));
app.use("/img/thumb/", function(req,res) { res.redirect("/static/img/thumbnotfound.png"); });
app.use("/img/thumb2x/", function(req,res) { res.redirect("/static/img/thumbnotfound.png"); });
app.post("/upload/post",express.bodyParser());
app.post("/upload/post", restrict, function(req,res) {
  if(!req.files || !req.files.image || !req.body.uploader || !req.body.author)
    { res.send(500,"Invalid!"); return; }
  var metadata = req.body;
  metadata.tags = tagArray(req.body.tags_string);
  var fn = req.files.image.name;
  var thfn = null;
  if(req.files.thumbnail) thfn = req.files.thumbnail.path;
  var ext = fileExt(fn);
  fs.readFile(req.files.image.path, function(err, data) {
    if(err) throw err;
    addImage(data,ext,req.body,function(){ res.send("OK"); },thfn,req.body.gravity);
  });
});

function handleQuery(entry,images,allImages) {
  if(entry.invert) return _(allImages).without(images);
  return images;
}
app.post("/search",express.bodyParser(), function(req,res) {
  var query = queryparser.parse(req.body.query);
  var stack = [];
  console.log(query);
  imageDB.images(function(allImages) {
    async.eachSeries(query, function(entry, next) {
      if(entry.type == "tag") {
        imageDB.imagesBy("tag",entry.key,function(images) { stack.push(handleQuery(entry,images,allImages)); next(); });
      } else if(entry.type == "string") {
        imageDB.imagesBy(entry.key,entry.value,function(images) { stack.push(handleQuery(entry,images,allImages)); next(); });
      } else if(entry.type == "numeric") {
        var pmin = 0, pmax = 2147483647, pin = parseInt(entry.value);
        if(entry.sign == "eq") { pmin = pin; pmax = pin; }
        else if(entry.sign == "lt") { pmax = pin-1; }
        else if(entry.sign == "le") { pmax = pin; }
        else if(entry.sign == "gt") { pmin = pin+1; }
        else if(entry.sign == "ge") { pmin = pin; }
        imageDB.imagesByNum(entry.key,pmin,pmax,function(images) { stack.push(images); next(); });
      } else if(entry.type == "linker" && stack.length >= 2) {
        var p1 = stack.pop()
          , p2 = stack.pop();
        if(entry.link == "or") stack.push(_.union(p1,p2));
        else if(entry.link == "and") stack.push(_.intersection(p1,p2));
        else if(entry.link == "xor") {
          var p3 = [];
          _.each(_.union(p1,p2),function(val) {
            if(_.contains(p1,val) != _.contains(p2,val)) p3.push(val);
          });
          stack.push(p3);
        }
        next();
      } else next();
    }, function() {
      // Done sorting!
      if(stack.length > 1) { res.send(500,"Something quite bad happened! "+JSON.stringify(stack)); return; }
      var result = stack.pop();
      listImages(req,res,result,0,false,{noAjaxLoad: true, isSearch: true, subtitle: Math.min(1000,result.length)+" results found."},1000);
    });
  });
});
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
        } else { res.send(403,"Invalid username or password!"); return; }
      });
    } else { res.send(403,"Invalid username or password!"); return; }
  });
});
app.get("/login", function(req,res) {
  res.send(makeTemplate("login",{req: req}));
});
app.get("/delete/*", restrictAdmin, parse, function(req,res) {
  console.log("Deleting ID " + req.params[0]);
  imageDB.unset(req.params[0],function(){res.redirect("/");});
});
app.get("/regenerate/*", restrictAdmin, parse, function(req,res) {
  console.log("Regenerating ID " + req.params[0]);
  imageDB.regenerate(req.params[0],function(){res.redirect("/");});
});
app.get("/upload", restrict, parse, function(req,res,next) {
  res.send(makeTemplate("upload",{req: req, username: req.session.user},req.params[0]));
});
app.post("/edit", express.bodyParser(), restrict, getImagePost, function(req,res) {
  console.log("/edit");
  var image = req.image;
  image.name = req.body.name || image.name;
  image.author = req.body.author || image.author;
  image.source = req.body.source || image.source;
  image.thumbnailGravity = req.body.gravity || image.thumbnailGravity;
  image.tags = tagArray(req.body.tags_string) || image.tags || [];
  if(req.files && req.files.thumbnail)
    thumbnail(req.files.thumbnail.path,"img/thumb/"+image.filename,"img/thumb2x/"+image.filename,thumbW*2,thumbH*2,image.thumbnailGravity);
  imageDB.set(image.id,image,function() {
    res.redirect("/");
  }, true);
});
app.get("/edit/*", restrict, parse, getImage, function(req,res) {
  res.send(makeTemplate("edit",{image: _.defaults(req.image, defaultImage), req: req},req.params[0]));
});
app.get("/image/*", parse, getImage, function(req,res) {
  res.send(makeTemplate("view",{image: _.defaults(req.image, defaultImage), req: req},req.params[0]));
});
function listImages(req,res,images1,p,p2,sub1,sub2,defConfig,maxVal) {
  var start = parseInt(p) || -1;
  var isRaw = p2 || false;
  var noHeader = false;
  if(start < 0) { start = 0; isRaw = p; }
  imageDB.range(images1,start,maxVal || config.pageSize,function(images2) {
    var conf = _.defaults({images: images2, position: start, maxpos: images1.length, req: req}, defConfig || {});
    if(_.isString(sub2))
      conf.subtitle = _.capitalize(sub1)+": "+sub2;
    else if(!conf.subtitle)
      conf.subtitle = "Now with " + conf.maxpos + " images!";
    var imagesLi = makeRawTemplate("images-li",conf,"raw",true);
    conf.imagesLi = imagesLi;
    if(isRaw == "append") res.send(conf.imagesLi);
    else res.send(makeTemplate("images",conf,isRaw,noHeader));
  });
}
app.get("/*",function(req,res) {
  var p = qs.unescape(req.path).split("/");
  console.log("Request: " + JSON.stringify(p)); 
  if(p.length>2 && (p[1] == "tag" || p[1] == "author" || p[1] == "uploader")) imageDB.imagesBy(p[1],p[2],function(images) { listImages(req,res,images,p[3],p[4],p[1],p[2]); });
  else imageDB.images(function(images) { listImages(req,res,images,p[1],p[2]); });
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
userDB.connect(client, config.salt);

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
  app.listen(config.port);
  console.log("Working on port " + config.port);
}

if(argv.r || argv.regen) {
  console.log("Regeneration requested, re-indexing images...");
  imageDB.images(function(images) {
    var bar = require('progress-bar').create(process.stdout,20);
    var i = 0;
    async.eachSeries(images,function(image, callback) { imageDB.regenerate(image,function(){i+=1; bar.update(i/images.length); callback();}); },function(){
      console.log("\nDone!");
      start();
    });
  });
}
else start();

process.on("uncaughtException", function(err) {
  console.log("Uncaught exception! Please report to author");
  console.log(err);
});
