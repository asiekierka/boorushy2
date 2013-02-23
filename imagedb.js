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

ImageDB.exists = function(id,cb) { return client.exists(client,"data:"+id,cb); }

ImageDB.addField = function(id,key,val,cb) {
  async.parallel([
    _.bind(client.sadd,client,key+"s",val),
    _.bind(client.sadd,client,key+":"+val,id),
    ], cb);
}
ImageDB.delField = function(id,key,val,cb) {
  async.series([
    _.bind(client.srem,client,key+":"+val,id),
    _.bind(client.scard,client,key+":"+val, function(err,card) {
      if(err) throw err;
      if(card==0) {
        client.del(key+":"+val);
        client.srem(key+"s",val);
      }})
    ], cb
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
ImageDB.set = function(id,data,cb) {
  data.id = id;
  var self = this;
  client.exists("data:"+id,function(err,exists) {
    var s = function() {
      async.parallel([
        _.bind(client.set,client,"data:"+id,JSON.stringify(data)),
        _.bind(client.sadd,client,"images",id),
        function(cb) { async.each(data.tags,_.bind(self.addField,self,id,"tag"), cb); },
        _.bind(self.addField,self,id,"author",data.author),
        _.bind(self.addField,self,id,"uploader",data.uploader)
      ], cb);
    };
    if(exists) self.get(id,function(data) { self.unset(id,s,true); });
    else s();
  });
}

ImageDB.unsetTags = function(id,tags,cb) {
  var t = this;
  async.each(tags,_.bind(t.delField,t,id,"tag"),cb);
}

ImageDB.unset = function(id,cb,dontTouchData) {
  var t = this;
  this.get(id,function(data) {
    async.parallel([
      function(cb) { if(!dontTouchData) client.del("data:"+id,cb); else cb(); },
      function(cb) { if(!dontTouchData) client.srem("images",id,cb); else cb(); },
      _.bind(t.unsetTags,t,id,data.tags),
      _.bind(t.delField,t,id,"author",data.author),
      _.bind(t.delField,t,id,"uploader",data.uploader)
    ],cb);
  });
}

exports.ImageDB = ImageDB;
