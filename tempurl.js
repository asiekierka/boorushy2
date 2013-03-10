var http = require('http')
  , fs = require('fs')
  , _ = require('underscore')
  , tmpfile = require('temporary/file');

exports.download = function(url, callback) {
  var file = new tmpfile;
  var req = http.get(url, function(response) {
    response.pipe(file);
    response.on("end", function() {
      callback(null,file.path,function(){ // Cleanup function
        file.unlinkSync();
      });
    });
  });
}
