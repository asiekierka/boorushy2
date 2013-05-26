var _ = require('underscore')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , im = require('imagemagick')
  , child = require('child_process')
  , async = require('async')
  , util = require('./util.js');

var thumbW = 300, thumbH = 300;

var config = {};

exports.setConfig = function(c) { config = c; }

exports.resize = function(src,dest,w,h,cb,grav) {
  var cnf = { srcPath: src, dstPath: dest,
              width: w, height: h+"^", quality: 0.9,
              customArgs: [ "-dispose", 2, "-coalesce", "-gravity", grav || "center", "-extent", w+"x"+h, "-layers", "OptimizePlus"] };
  im.resize(cnf,cb);
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
  if(config.optimize == "none" || !fs.existsSync(path)) return;
  var oldfilesize = util.filesize(path);
  var format = (data.format || util.fileExt(path)).toLowerCase();
  if(format=="jpeg") format="jpg";
  optqueue.push({path: path, format: format}, function(err) {
    console.log("Done optimizing "+path+", "+oldfilesize+" -> "+util.filesize(path));
  });
}

exports.handle = function(src,destName,w1,h1,grav,options) {
  var w = w1 || thumbW*2
    , h = h1 || thumbH*2
    , dest = "./img/thumb/"+destName
    , dest2x = "./img/thumb2x/"+destName
    , self = this;
  console.log("Thumbnailing " + src + " to " + dest);
  t2 = function(err) {
    if(err) throw err;
    if(_.isString(dest2x) && (w>thumbW || h>thumbH))
      self.resize(src,dest2x,thumbW*2,thumbH*2,function(err) {
        if(err) throw err;
        if(config.optimize == "all" || config.optimize == "thumbnails") {
          self.optimize(dest,{format: util.fileExt(src)});
          self.optimize(dest2x,{format: util.fileExt(src)});
        }
	console.log("Done!");
        if(_.isFunction(options.callback)) options.callback();
      },grav);
    else if(_.isFunction(options.callback)) options.callback();
  };
  this.resize(src,dest,thumbW,thumbH,t2,grav);
  if(options.optimizeSrc && config.optimize == "all" && _(src).startsWith("./img")) self.optimize(src,{format: util.fileExt(src)});
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
