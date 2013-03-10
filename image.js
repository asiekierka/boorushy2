var _ = require('underscore')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , im = require('imagemagick')
  , config = require('./config.json')
  , child = require('child_process')
  , async = require('async')
  , path = require('path');

var thumbW = 300, thumbH = 300;

exports.resize = function(src,dest,w,h,cb,grav) {
  var cnf = { srcPath: src, dstPath: dest,
              width: w, height: h+"^", quality: 0.9,
              customArgs: [ "-dispose", 2, "-coalesce", "-gravity", grav || "center", "-extent", w+"x"+h, "-layers", "OptimizePlus"] };
  im.resize(cnf,cb);
}

function copy(src,dest) {
  fs.createReadStream(src).pipe(fs.createWriteStream(dest));
}

function filesize(name) {
  return fs.statSync(name).size;
}

var optqueue = async.queue(function (task, callback) {
  if(!config.optimizationEngines) callback();
  async.eachSeries(config.optimizationEngines, function(engine,b) {
    if(!engine.enabled || task.format != engine.format) b();
    else {
      console.log("Optimizing "+task.path+" with engine " + engine.name);
      var epath = engine.path.replace(/\$FILE/g, task.path);
      child.exec(epath, function(err, stdout, stderr) {
        console.log(stdout);
        callback(err);
      });
    }
  });
}, config.optimizationThreads || 1);

exports.optimize = function(path,data) {
  if(!fs.existsSync(path)) return;
  var oldfilesize = filesize(path);
  var format = (data.format || fileExt(path)).toLowerCase();
  if(format=="jpeg") format="jpg";
  optqueue.push({path: path, format: format}, function(err) {
    console.log("Done optimizing "+path+", "+oldfilesize+" -> "+filesize(path));
  });
}

exports.thumbnail = function(src,dest,dest2x,w1,h1,grav,cb) {
  var w = w1 || thumbW*2
    , h = h1 || thumbH*2
    , self = this;
  console.log("Thumbnailing " + src);
  t2 = function() {
    if(_.isString(dest2x) && (w>thumbW || h>thumbH))
      self.resize(src,dest2x,thumbW*2,thumbH*2,function() {
        self.optimize(dest,{format: fileExt(src)});
        self.optimize(dest2x,{format: fileExt(src)});
	console.log("Done!");
        cb();
      },grav);
    else cb();
  };
  this.resize(src,dest,thumbW,thumbH,t2,grav);
}

// File/thumbnail
function fileExt(name) {
  var ext = path.extname(name).split(".");
  return ext[ext.length-1];
}

// Create missing directories (just in case)
mkdirp.sync("./img/src");
mkdirp.sync("./img/thumb");
mkdirp.sync("./img/thumb2x");

exports.express = function(express,app) {
  console.log("[image.js] Installing Express hooks");
  app.use("/static/",express.compress());
  app.use("/static/",express.static("./bootstrap"));
  app.use("/static/",express.static("./static"));
  app.use("/img/",express.static("./img"));
  app.use("/img/thumb2x/",express.static("./img/thumb"));
  app.use("/img/thumb/", function(req,res) { res.redirect("/static/img/thumbnotfound.png"); });
  app.use("/img/thumb2x/", function(req,res) { res.redirect("/static/img/thumbnotfound.png"); });
}
