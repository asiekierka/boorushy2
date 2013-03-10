var http = require('http')
  , fs = require('fs')
  , _ = require('underscore')
  , temp = require('temp')
  , path = require('path')
  , os = require('os');

function fileExt(name) {
  var ext = path.extname(name).split(".");
  return ext[ext.length-1];
}

exports.download = function(url, callback) {
  var now = new Date();
  var tmpfn = path.join(os.tmpDir(), [
    "tmp-", now.getTime(), "-", Math.floor(Math.random()*1000000),
    ".", fileExt(url)
  ].join(""));
  console.log("Downloading " + url + " to " + tmpfn);
  var stream = fs.createWriteStream(tmpfn);
  var req = http.get(url, function(response) {
    response.on("data", function(chunk){stream.write(chunk);});
    response.on("end", function() {
      stream.on("close", function() {
        callback(null,tmpfn, function() {
          fs.unlinkSync(tmpfn);
        });
      });
      stream.end();
      stream.destroy();
    });
  });
}
