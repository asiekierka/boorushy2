var ImageDB = {}
  , redis = require("redis")
  , _ = require("underscore")
  , JSON = require("JSON2")
  , async = require("async");

var client = null;

ImageDB.connect = function(port,host,options) {
  client = redis.createClient(port || null, host || null, options || {});
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

ImageDB.exists = function(id,callback) { return client.exists(client,"data:"+id,callback); }

ImageDB.addField = function(id,key,val,callback) {
  async.parallel([
    _.bind(client.sadd,client,key+"s",val),
    _.bind(client.sadd,client,key+":"+val,id),
    ], callback);
}
ImageDB.delField = function(id,key,val,callback) {
  async.series([
    _.bind(client.srem,client,key+":"+val,id),
    _.bind(client.scard,client,key+":"+val, function(err,card) {
      if(err) throw err;
      if(card==0) {
        client.del(key+":"+val);
        client.srem(key+"s",val);
      }})
    ], callback
  );
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
ImageDB.hashed = function(hash,callback) {
  client.sismember("hashes",hash,function(err,ishashed) {
    callback(ishashed);
  });
}

ImageDB.set = function(id,data,callback,noHashCheck) {
  data.id = id;
  var self = this;
  client.sismember("hashes",data.hash,function(err,ishashed) {
    if(err) throw err;
    if(noHashCheck || !ishashed)
      client.exists("data:"+id,function(err,exists) {
        var s = function() {
          async.parallel([
            _.bind(client.set,client,"data:"+id,JSON.stringify(data)),
            _.bind(client.sadd,client,"images",id),
            _.bind(client.sadd,client,"hashes",data.hash),
           function(callback) { async.each(data.tags,_.bind(self.addField,self,id,"tag"), callback); },
            _.bind(self.addField,self,id,"author",data.author),
            _.bind(self.addField,self,id,"uploader",data.uploader)
          ], callback);
        };
        if(exists) self.get(id,function(data) { self.unset(id,s,true); });
        else s();
      });
    else { if(callback) callback(new Error("File already exists!")); else return; }    
  });
}

ImageDB.unsetTags = function(id,tags,callback) {
  var t = this;
  async.each(tags,_.bind(t.delField,t,id,"tag"),callback);
}

ImageDB.unset = function(id,callback,dontTouchData) {
  var t = this;
  this.get(id,function(data) {
    if(data == null) callback();
    async.parallel([
      function(callback) { if(!dontTouchData) client.del("data:"+id,callback); else callback(); },
      function(callback) { if(!dontTouchData) client.srem("images",id,callback); else callback(); },
      function(callback) { if(!dontTouchData) client.srem("hashes",data.hash,callback); else callback(); },
      _.bind(t.unsetTags,t,id,data.tags),
      _.bind(t.delField,t,id,"author",data.author),
      _.bind(t.delField,t,id,"uploader",data.uploader)
    ],callback);
  });
}

exports.ImageDB = ImageDB;
