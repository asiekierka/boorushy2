var ImageDB = {}
  , redis = require("redis")
  , _ = require("underscore")
  , async = require("async")
  , util = require("./util.js");

var client = null
  , CURRENT_VERSION = 2
  , cloudTags = ["tag", "author", "uploader"]
  , config = null
  , prefix = "";

ImageDB.connect = function(cli,conf) {
  client = cli;
  config = conf;
  prefix = conf.database.prefix;
}
ImageDB.log = function(t) { console.log("[ImageDB] "+t); }
ImageDB.getVersion = function(cb) {
  client.get(prefix+"db_version",function(err, out) {
    if(err) cb(1);
    else cb((parseInt(out)>0) ? parseInt(out) : 1);
  });
}
ImageDB.updateDatabase = function(callback) {
  var self = this;
  self.getVersion(function(version) {
    if(version == 1) {
      version = 2;
      self.log("Updating DB from version 1 to 2");
      self.updateCloud(function(){
        self.log("Done updating!");
        client.set(prefix+"db_version", 2, _.bind(self.updateDatabase, self));
      });
    }
    else if(version == CURRENT_VERSION) { self.log("Latest DB version, nothing to do..."); if(_.isFunction(callback)) callback(); }
  });
}

// CLOUD CODE

ImageDB.isCloudTag = function(text) { return _(cloudTags).contains(text); }
ImageDB.updateCloud = function(callback) {
  var self = this;
  async.each(cloudTags, function(item, cb) {
    self.generateCloud(item, cb);
  }, callback);
}
ImageDB.getCloud = function(name, cb) {
  client.zrange(prefix+"cloud:"+name,0,-1,'WITHSCORES',function(err, data) {
    if(err) throw err;
    var fixedData = {};
    while(data.length > 0) {
      var name = data.shift();
      fixedData[name] = parseInt(data.shift());
    }
    cb(fixedData);
  });
}
ImageDB.generateCloud = function(name, cb) {
  this.log("(Re)generating tag cloud "+name+"...");
  client.smembers(prefix+name+"s", function(err, out) {
    if(err) throw err;
    var counts = async.map(out, function(tagName, callback) {
      client.scard(prefix+name+":"+tagName, function(err, out) { // Count
        callback(err, {"name": tagName, "count": out});
      });
    }, function(err, out) {
      if(err) throw err;
      var output = {};
      async.eachSeries(out, function(tag, callback) {
        if(tag.count == 0 || tag.name == "") callback();
        else client.zadd(prefix+"cloud:"+name, tag.count, tag.name, callback);
      }, cb);
    });
  });
}

ImageDB.get = function(id,callback) {
  client.get(prefix+"data:"+id,function(err,out) {
    if(err) throw err;
    callback(JSON.parse(out));
  });
}
ImageDB.getWithError = function(id,callback) {
  client.get(prefix+"data:"+id,function(err,out) {
    callback(err,JSON.parse(out));
  });
}

ImageDB.exists = function(id,callback) { return client.exists(client,prefix+"data:"+id,callback); }

ImageDB.listFields = function(name,callback) {
  client.smembers(prefix+name, function(err,m) {
    if(err) throw err;
    if(_.isNull(m)) callback(new Array());
    else callback(m.sort());
  });
}
ImageDB.listImages = function(name,callback) {
  client.smembers(prefix+name, function(err,m) {
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
  client.zrangebyscore(prefix+"size:"+key,min,max,function(err,m) {
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
  client.setnx(prefix+"counter:"+name,0);
  client.incr(prefix+"counter:"+name,callback);
}
ImageDB.uncount = function(name,callback) {
  client.setnx(prefix+"counter:"+name,0);
  client.decr(prefix+"counter:"+name,callback);
}
ImageDB.add = function(data,callback) {
  this.count("imageId",function(count) {
    this.set(count,data);
    if(_.isFunction(callback))
      callback(count);
  });
}
ImageDB.hashed = function(hash,callback) {
  client.sismember(prefix+"hashes",hash,function(err,ishashed) {
    callback(ishashed);
  });
}


ImageDB.addField = function(id,key,val,callback) {
  async.parallel([
    _.bind(client.sadd,client,prefix+key+"s",val),
    _.bind(client.sadd,client,prefix+key+":"+val,id),
    ], callback);
}
ImageDB.delField = function(id,key,val,callback) {
  async.series([
    _.bind(client.srem,client,prefix+key+":"+val,id),
    function(cb) {
      client.scard(prefix+key+":"+val,function(err,card) {
        if(err) throw err;
        if(card==0)
          async.parallel([
            _.bind(client.del,client,prefix+key+":"+val),
            _.bind(client.srem,client,prefix+key+"s",val)
          ],cb);
        else cb();
      });
    }
  ], callback);
}

ImageDB.addSize = function(id,key,val,callback) {
  client.zadd(prefix+"size:"+key,val,id,callback);
}
ImageDB.delSize = function(id,key,callback) {
  client.zrem(prefix+"size:"+key,id,callback);
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
    _.bind(client.sadd,client,prefix+"hashes",data.hash),
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
    _.bind(client.srem,client,prefix+"hashes",data.hash),
    _.bind(self.unsetTags,self,id,data.tags),
    function(cb) { cb(); },
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
      client.exists(prefix+"data:"+id,function(err,exists) {
        var s = function() {
          async.parallel([
            _.bind(client.set,client,prefix+"data:"+id,JSON.stringify(data)),
            _.bind(client.sadd,client,prefix+"images",id),
            _.bind(self.setSearchData,self,id,data),
            _.bind(self.updateCloud,self)
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
      function(callback) { if(!dontTouchData) client.del(prefix+"data:"+id,callback); else callback(); },
      function(callback) { if(!dontTouchData) client.srem(prefix+"images",id,callback); else callback(); },
      _.bind(self.unsetSearchData,self,id,data),
      _.bind(self.updateCloud,self)
    ],callback);
  });
}

exports.ImageDB = ImageDB;
