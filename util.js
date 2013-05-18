var _ = require("underscore")
  , fs = require("fs")
  , path = require("path");

exports.fileExt = function(name) {
  var ext = path.extname(name).split(".");
  return ext[ext.length-1];
}
exports.tagArray = function(str) {
  var t = str.split(",");
  t = _.map(t,function(v){return v.trim();});
  return t;
}
exports.copyFile = function(src,dest) {
  fs.createReadStream(src).pipe(fs.createWriteStream(dest));
}
exports.filesize = function(name) {
  return fs.statSync(name).size;
}
