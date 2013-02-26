var UserDB = {}
  , redis = require("redis")
  , _ = require("underscore")
  , JSON = require("JSON2")
  , async = require("async")
  , crypto = require('crypto');

var client = null
  , salt = "DummyDummyDummyDummy";

UserDB.connect = function(cli,s) { client = cli; salt = s; }

UserDB.get = function(nick,callback) {
  client.get("user:"+nick,function(err,out) {
    callback(err,JSON.parse(out));
  });
}

UserDB.exists = function(nick,callback) { return client.exists("user:"+nick,callback); }

UserDB.hash = function(pass,iter) {
  var iters = 32000 || iter;
  var t = pass;
  for(i=0;i<iters;i++)
    t = crypto.createHash('md5').update(salt + t).digest("hex");
  return t;
}

UserDB.addUser = function(data,callback) {
  if(data == null || data.user == null) callback(new Error("Invalid user data!"));
  else if(data.pass == null) callback(new Error("Invalid password!"));
  else this.exists(data.user, function(err, does) {
    if(err) callback(err);
    else if(does) callback(new Error("User exists!"));
    else async.series([
      _.bind(client.set,client,"user:"+data.user,JSON.stringify(data)),
      _.bind(client.sadd,client,"users",data.user)
     ], callback);
  });
}
UserDB.list = function(callback) { client.smembers("users",callback); }

exports.UserDB = UserDB;
