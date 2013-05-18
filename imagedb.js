var ImageDB = {}
  , redis = require("redis")
  , _ = require("underscore")
  , async = require("async");

var client = null;

ImageDB.connect = function(cli) { client = cli; }

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
ImageDB.imagesByNum = function(key,min,max,callback){
  client.zrangebyscore("size:"+key,min,max,function(err,m) {
    if(err) throw err;
    if(_.isNull(m)) callback(new Array());
    else callback(_.sortBy(m,function(num){ return 0-num; }));
  });
}

ImageDB.getArray = function(arr,callback) {
  async.map(arr, this.getWithError, callback);
}

ImageDB.range = function(arr2,s,l,callback) {
  var out = new Array();
  var arr = arr2;
  if(_.isNumber(arr2)) arr = new Array(arr2);
  arr = _.first(_.rest(arr,s),l);
  this.getArray(arr,function(err, results) {
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


ImageDB.addField = function(id,key,val,callback) {
  async.parallel([
    _.bind(client.sadd,client,key+"s",val),
    _.bind(client.sadd,client,key+":"+val,id),
    ], callback);
}
ImageDB.delField = function(id,key,val,callback) {
  async.series([
    _.bind(client.srem,client,key+":"+val,id),
    function(cb) {
      client.scard(key+":"+val,function(err,card) {
        if(err) throw err;
        if(card==0)
          async.parallel([
            _.bind(client.del,client,key+":"+val),
            _.bind(client.srem,client,key+"s",val)
          ],cb);
        else cb();
      });
    }
  ], callback);
}

ImageDB.addSize = function(id,key,val,callback) {
  client.zadd("size:"+key,val,id,callback);
}
ImageDB.delSize = function(id,key,callback) {
  client.zrem("size:"+key,id,callback);
}

ImageDB.setTags = function(id,tags,callback) {
  var t = this;
  if(tags == null || tags.length == 0) callback();
  else async.each(tags,_.bind(t.addField,t,id,"tag"),callback);
}
ImageDB.unsetTags = function(id,tags,callback) {
  var t = this;
  if(tags == null || tags.length == 0) callback();
  else async.each(tags,_.bind(t.delField,t,id,"tag"),callback);
}

ImageDB.setSearchData = function(id, data, callback) {
  var self = this;
  async.parallel([
    _.bind(client.sadd,client,"hashes",data.hash),
    _.bind(self.setTags,self,id,data.tags),
    _.bind(self.addField,self,id,"author",data.author),
    _.bind(self.addField,self,id,"uploader",data.uploader),
    _.bind(self.addSize,self,id,"width",data.width),
    _.bind(self.addSize,self,id,"height",data.height)
  ], callback);
}
ImageDB.unsetSearchData = function(id, data, callback) {
  var self = this;
  async.series([
    _.bind(client.srem,client,"hashes",data.hash),
    _.bind(self.unsetTags,self,id,data.tags),
    function(cb) { console.log("dbg"); cb(); },
    _.bind(self.delField,self,id,"author",data.author),
    _.bind(self.delField,self,id,"uploader",data.uploader),
    _.bind(self.delSize,self,id,"width"),
    _.bind(self.delSize,self,id,"height")
  ], callback);
}

ImageDB.regenerate = function(id, callback) {
  var self = this;
  this.get(id, function(data) {
    async.series([
      _.bind(self.unsetSearchData,self,id,data),
      _.bind(self.setSearchData,self,id,data)
    ], callback);
  });
}

ImageDB.set = function(id,data,callback,noHashCheck) {
  data.id = id;
  var self = this;
  this.hashed(data.hash,function(ishashed) {
    if(noHashCheck || !ishashed)
      client.exists("data:"+id,function(err,exists) {
        var s = function() {
          async.parallel([
            _.bind(client.set,client,"data:"+id,JSON.stringify(data)),
            _.bind(client.sadd,client,"images",id),
            _.bind(self.setSearchData,self,id,data)
          ], callback);
        };
        if(exists) self.get(id,function(data) { self.unset(id,s,true); });
        else s();
      });
    else { if(callback) callback(new Error("File already exists!")); else return; }    
  });
}

ImageDB.unset = function(id,callback,dontTouchData) {
  var self = this;
  this.get(id,function(data) {
    if(data == null) callback();
    async.parallel([
      function(callback) { if(!dontTouchData) client.del("data:"+id,callback); else callback(); },
      function(callback) { if(!dontTouchData) client.srem("images",id,callback); else callback(); },
      _.bind(self.unsetSearchData,self,id,data)
    ],callback);
  });
}


exports.ImageDB = ImageDB;
