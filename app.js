var express = require('express')
  , mkdirp = require('mkdirp')
  , _ = require('underscore')
  , fs = require('fs')
  , JSON = require('JSON2')
  , imageDB = require('./imagedb.js').ImageDB
  , im = require('imagemagick')
  , program = require('commander')
  , path = require('path')
  , qs = require('querystring');

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

function resize(src,dest,w,h) {
  var cnf = { srcPath: src, dstPath: dest,
              width: w, height: h+"^",
              customArgs: [ "-gravity", "center", "-extent", w+"x"+h ] };
  im.resize(cnf,null);
}

function thumbnail(src,dest,dest2x) {
  resize(src,dest,thumbW,thumbH);
  if(_.isString(dest2x))
    resize(src,dest2x,thumbW*2,thumbH*2);
}

function addImage(rawdata,format,info,callback) {
  imageDB.count("imageId",function(err,id) {
    var path = id+"."+format;
    fs.writeFile("img/src/"+path,rawdata,"utf8",function() {
      im.identify("img/src/"+path, function(err,features) {
        if(err) throw err;
        var data = { id: id, format: format, filename: path, originalFilename: info.filename,
                     width: features.width, height: features.height};
        data = _.defaults(data,info);
        imageDB.set(id,_.defaults(data,defaultImage));
        if(_.isFunction(callback)) callback();
      });
      thumbnail("img/src/"+path,"img/thumb/"+path,"img/thumb2x/"+path);
    });
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

// Create missing directories (just in case)
mkdirp.sync("img/src");
mkdirp.sync("img/thumb");
mkdirp.sync("img/thumb2x");

// Load directory dependencies
app.use("/static/",express.compress());
app.use("/static/",express.static("bootstrap"));
app.use("/static/",express.static("static"));
app.use("/img/",express.static("img"));
app.use("/img/thumb/", function(req,res) { res.redirect("/static/img/thumbnotfound.png"); });
app.use("/img/thumb2x/", function(req,res) { res.redirect("/static/img/thumbnotfound.png"); });
app.use("/upload/",express.basicAuth("admin","admin"));
app.post("/upload/post",express.bodyParser());
app.post("/upload/post", function(req,res) {
  if(!req.files || !req.files.image || !req.body.uploader || !req.body.author)
    { res.send(500,"INVALID"); return; }
  var metadata = req.body;
  metadata.tags = _.map(req.body.tags_string.split(","), _.trim);
  var fn = req.files.image.name;
  var ext = fileExt(fn);
  fs.readFile(req.files.image.path, function(err, data) {
    if(err) throw err;
    addImage(data,ext,req.body,function(){ res.send("OK"); });
  });
});
app.use("/upload/",function(req,res) {
  var p = qs.unescape(req.path).split("/");
  res.send(makeTemplate("upload",{username: "admin"},p[1]));
});
app.use("/image/",function(req,res) {
  var p = qs.unescape(req.path).split("/");
  if(!p[1]) res.send(500);
  imageDB.get(p[1],function(data) {
    res.send(makeTemplate("view",{image: _.defaults(data, defaultImage)},p[2]));
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
app.use("/",function(req,res) {
  var p = qs.unescape(req.path).split("/");
  console.log("Request: " + JSON.stringify(p)); 
  if(p.length>2 && (p[1] == "tag" || p[1] == "author" || p[1] == "uploader")) imageDB.imagesBy(p[1],p[2],function(images) { listImages(res,images,p[3],p[4],p[1],p[2]); });
  else imageDB.images(function(images) { listImages(res,images,p[1],p[2]); });
});

imageDB.connect();
app.listen(config.port);
console.log("Working on port " + config.port);

program.version("0.0.1");
program.command("add [file]")
       .description("add file to db")
       .action(function(filename){
         addImage(fs.readFileSync(filename),fileExt(filename),{tags: ["test","less tests"],filename: filename});
       });

program.parse(process.argv);
