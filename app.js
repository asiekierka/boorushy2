var express = require('express')
  , mkdirp = require('mkdirp')
  , _ = require('underscore')
  , fs = require('fs')
  , JSON = require('JSON2')
  , imageDB = require('./imagedb.js').ImageDB
  , im = require('imagemagick')
  , path = require('path')
  , qs = require('querystring')
  , crypto = require('crypto');

_.str = require('underscore.string');
_.mixin(_.str.exports());

var app = express()
  , config = require('./config.json')
  , templates = {};

var defaultImage = { author: "Unknown", source: "/", uploader: "Computer"};
var defaultSiteConfig = { subtitle: null, title: "Website", htmlTitle: null};

_.each(fs.readdirSync("templates/"),function(filename) {
  var name = filename.split(".")[0];
  console.log("[Template] Loading template "+name);
  templates[name] = fs.readFileSync("templates/"+filename,"utf8");    
});

function fileExt(name) {
  var ext = path.extname(name).split(".");
  return ext[ext.length-1];
}

var thumbW = 300, thumbH = 300;

function resize(src,dest,w,h,cb) {
  var cnf = { srcPath: src, dstPath: dest,
              width: w, height: h+"^",
              customArgs: [ "-dispose", 2, "-coalesce", "-gravity", "center", "-extent", w+"x"+h, "-layers", "OptimizePlus"] };
  im.resize(cnf,null,cb);
}

function copy(src,dest) {
  fs.createReadStream(src).pipe(fs.createWriteStream(dest));
}

function thumbnail(src,dest,dest2x,w,h) {
  t2 = function() {
    if(_.isString(dest2x) && thumbW*2<w || thumbH*2<h)
      resize(src,dest2x,thumbW*2,thumbH*2);
  };
  if(thumbW<w || thumbH<h) resize(src,dest,thumbW,thumbH,t2);
  else { copy(src,dest); t2(); }
}

function addImage(rawdata,format,info,callback) {
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
                       width: features.width, height: features.height, hash: hash};
          data = _.defaults(data,info);
          imageDB.set(id,_.defaults(data,defaultImage));
          thumbnail("img/src/"+path,"img/thumb/"+path,"img/thumb2x/"+path,features.width,features.height);
          if(_.isFunction(callback)) callback();
        });
      });
    });  
    else if(_.isFunction(callback)) callback(new Error("File already exists!"));
  });
}

function makeRawTemplate(name,conf,noHeader) {
  var conf2 = _.defaults(conf,config,defaultSiteConfig);
  var body = _.template(templates[name],conf2);
  if(!noHeader)
    body = _.template(templates["header"],conf2) + body;
  return body;
}
function makeTemplate(name,conf,raw,noHeader) {
  if(raw=="raw") return makeRawTemplate(name,conf,noHeader);
  var conf2 = _.defaults(conf,config,defaultSiteConfig);
  return _.template(templates["main"],_.defaults(conf2,{page: makeRawTemplate(name,conf,noHeader)}));
}

function tagArray(str) {
  var t = str.split(",");
  t = _.map(t,function(v){return v.trim();});
  console.log(t);
  return t;
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
app.all("/upload*",express.basicAuth("admin2","admin"));
app.all("/edit*",express.basicAuth("admin2","admin"));
app.all("/delete*",express.basicAuth("admin2","admin"));
app.post("/upload/post",express.bodyParser());
app.post("/upload/post", function(req,res) {
  if(!req.files || !req.files.image || !req.body.uploader || !req.body.author)
    { res.send(500,"INVALID"); return; }
  var metadata = req.body;
  metadata.tags = tagArray(req.body.tags_string);
  var fn = req.files.image.name;
  var ext = fileExt(fn);
  fs.readFile(req.files.image.path, function(err, data) {
    if(err) throw err;
    addImage(data,ext,req.body,function(){ res.send("OK"); });
  });
});
app.get("/delete/*", function(req,res) {
  var p = qs.unescape(req.path).split("/");
  console.log("Deleting ID " + p[2]);
  imageDB.unset(p[2],function(){res.redirect("/");});
});
app.get("/upload/*",function(req,res) {
  var p = qs.unescape(req.path).split("/");
  res.send(makeTemplate("upload",{username: "admin"},p[2]));
});
app.get("/image/*",function(req,res) {
  var p = qs.unescape(req.path).split("/");
  imageDB.get(p[2],function(data) {
    if(data==null) { res.send(404,"Image not found!"); return; }
    res.send(makeTemplate("view",{image: _.defaults(data, defaultImage)},p[3]));
  });
});
app.post("/edit/*",express.bodyParser());
app.post("/edit/*",function(req,res) {
  var p = qs.unescape(req.path).split("/");
  var id = p[2];
  imageDB.get(id,function(dat) {
    var data = dat;
    if(data==null) { res.send(404,"Image not found!"); return; }
    data.name = req.body.name;
    data.author = req.body.author;
    data.source = req.body.source;
    data.tags = tagArray(req.body.tags_string) || [];
    imageDB.set(id,data);
    res.redirect("/");
  });
});
app.get("/edit/*",function(req,res) {
  var p = qs.unescape(req.path).split("/");
  imageDB.get(p[2],function(data) {
    if(data==null) { res.send(404,"Image not found!"); return; }
    res.send(makeTemplate("edit",{image: _.defaults(data, defaultImage, {tags: []})},p[2]));
  });
});
function listImages(res,images1,p,p2,sub1,sub2) {
  var start = parseInt(p) || -1;
  var isRaw = p2 || false;
  var noHeader = false;
  if(start < 0) { start = 0; isRaw = p; }
  imageDB.range(images1,start,config.pageSize,function(images2) {
    var conf = {images: images2, position: start, maxpos: images1.length};
    if(_.isString(sub2))
      conf.subtitle = _.capitalize(sub1)+": "+sub2;
    var imagesLi = makeRawTemplate("images-li",conf,"raw",true);
    conf.imagesLi = imagesLi;
    if(isRaw == "append") res.send(conf.imagesLi);
    else res.send(makeTemplate("images",conf,isRaw,noHeader));
  });
}
app.get("/*",function(req,res) {
  var p = qs.unescape(req.path).split("/");
  console.log("Request: " + JSON.stringify(p)); 
  if(p.length>2 && (p[1] == "tag" || p[1] == "author" || p[1] == "uploader")) imageDB.imagesBy(p[1],p[2],function(images) { listImages(res,images,p[3],p[4],p[1],p[2]); });
  else imageDB.images(function(images) { listImages(res,images,p[1],p[2]); });
});

imageDB.connect();
app.listen(config.port);
console.log("Working on port " + config.port);
