var ImageDB = {}
  , redis = require("redis")
  , _ = require("underscore")
  , JSON = require("JSON2")
  , async = require("async");

var client = null;

ImageDB.connect = function(port,host,options) {
  client = redis.createClient(port || null,host || null,options || {});
}

ImageDB.get = function(id,callback) {
  client.get("data:"+id,function(err,out) {
    if(err) throw err;
    callback(JSON.parse(out));
  });
}
ImageDB.getWithError = function(id,callback) {
  client.get("data:"+id,function(err,out) {
    callback(err,JSON.parse(out));
  });
}

ImageDB.exists = function(id,cb) { return client.exists(client,"data:"+id,cb); }

ImageDB.addField = function(id,key,val) {
  client.sadd(key+"s",val);
  client.sadd(key+":"+val,id);
}
ImageDB.delField = function(id,key,val) {
  client.srem(key+":"+val,id);
  client.scard(key+":"+val, function(err,m) {
    if(err) throw err;
    if(m>0) return;
    client.del(key+":"+val);
    client.srem(key+"s",val);
  });
}

ImageDB.listFields = function(name,callback) {
  client.smembers(name, function(err,m) {
    if(err) throw err;
    if(_.isNull(m)) callback(new Array());
    else callback(m.sort());
  });
}
ImageDB.listImages = function(name,callback) {
  client.smembers(name, function(err,m) {
    if(err) throw err;
    if(_.isNull(m)) callback(new Array());
    else callback(_.sortBy(m,function(num){ return 0-num; }));
  });
}
ImageDB.tags = _.partial(ImageDB.listFields,"tags");
ImageDB.authors = _.partial(ImageDB.listFields,"authors");
ImageDB.uploaders = _.partial(ImageDB.listFields,"uploaders");
ImageDB.images = _.partial(ImageDB.listImages,"images");
ImageDB.imagesBy = function(key,val,callback){
  this.listImages(key+":"+val,callback);
}
ImageDB.range = function(arr2,s,l,callback) {
  var out = new Array();
  var arr = arr2;
  if(_.isNumber(arr2)) arr = new Array(arr2);
  arr = _.first(_.rest(arr,s),l);
  async.map(arr,this.getWithError,function(err, results) {
    if(err) throw err;
    callback(results);
  });
}

ImageDB.count = function(name,callback) {
  client.setnx("counter:"+name,0);
  client.incr("counter:"+name,callback);
}
ImageDB.uncount = function(name,callback) {
  client.setnx("counter:"+name,0);
  client.decr("counter:"+name,callback);
}
ImageDB.add = function(data,callback) {
  this.count("imageId",function(count) {
    this.set(count,data);
    if(_.isFunction(callback))
      callback(count);
  });
}
ImageDB.set = function(id,data) {
  data.id = id;
  client.set("data:"+id,JSON.stringify(data));
  client.sadd("images",id);
  var t = this;
  _.each(data.tags,function(tag) { t.addField(id,"tag",tag); });
  if(_.isString(data.author))
    this.addField(id,"author",data.author);
  if(_.isString(data.uploader))
    this.addField(id,"uploader",data.uploader);
}

ImageDB.unset = function(id) {
  this.get(id,function(data) {
    client.del("data:"+id);
    client.srem("images",id);
    var t = this;
    _.each(data.tags,function(tag) { t.delField(id,"tag",tag); });
    if(_.isString(data.author))
      this.delField(id,"author",data.author);  
    if(_.isString(data.uploader))
      this.delField(id,"uploader",data.uploader);
  });
}

exports.ImageDB = ImageDB;
