var CacheDB = {}
  , redis = require("redis")
  , _ = require("underscore")
  , JSON = require("JSON2")
  , async = require("async")
  , crypto = require('crypto');

var client = null;

CacheDB.connect = function(cli) { client = cli; }

CacheDB.get = function(query,callback) {
  client.get("cache:"+this.hash(query),function(err,out) {
    callback(err,JSON.parse(out));
  });
}

CacheDB.exists = function(query,callback) { return client.exists("cache:"+this.hash(query),callback); }

CacheDB.hash = function(data) {
  return crypto.createHash('md5').update(data).digest("hex");
}

CacheDB.set = function(query,data,ttl,callback) {
  if(data == null) callback(new Error("Invalid query data!"));
  else if(query == null) callback(new Error("Invalid query name!"));
  else async.series([
    _.bind(client.set,client,"cache:"+this.hash(query),JSON.stringify(data)),
    _.bind(client.expire,client,"cache:"+this.hash(query),ttl || 60)
  ], callback);
}

exports.CacheDB = CacheDB;
