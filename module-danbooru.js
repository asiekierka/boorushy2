// Danbooru API emulation
// fits inside app.js

function toDanbooruFormat(item) {
 var isQuestionable = ( _.intersection(item.tags, config.tags.spoiler).length > 0)
   , isExplicit = ( _.intersection(item.tags, config.tags.hidden).length > 0);

 return{"approver_id": null,
	"created_at": "1970-01-01T00:00:00+00:00",
	"down_score": 0,
	"fav_count": 0,
	"fav_string": "",
	"file_ext": item.format,
	"file_size": util.filesize("./img/src/"+item.filename), // TODO: Index this!
	"has_children": false,
	"id": item.id,
	"image_height": item.height,
	"image_width": item.width,
	"is_banned": false,
	"is_deleted": false,
	"is_flagged": false,
	"is_note_locked": false,
	"is_pending": false,
	"is_rating_locked": isQuestionable || isExplicit,
	"is_status_locked": false,
	"last_commented_at": null,
	"last_noted_at": null,
	"md5": item.hash,
	"parent_id": null,
	"pixiv_id": 0,
	"pool_string":"",
	"rating": (isExplicit ? "e" : (isQuestionable ? "q" : "s")),
	"score": 0,
	"source": item.source,
	"tag_count": item.tags.length,
	"tag_count_artist": ((_.isString(item.author) && item.author != "") ? 1 : 0),
	"tag_count_character": 0,
	"tag_count_copyright": 0,
	"tag_count_general": item.tags.length,
	"tag_string": item.tags.join(" "),
	"up_score": 0,
	"updated_at": "1970-01-01T00:00:00+00:00",
	"uploader_id": 1, // TODO: Make a real uploader ID!
	"uploader_name": item.uploader,
	"has_large": false,
	"tag_string_artist": "author:"+item.author,
	"tag_string_character": "",
	"tag_string_copyright": "",
	"tag_string_general": item.tags.join(" "),
	"file_url": "/img/src/"+item.filename,
	"large_file_url": "/img/src/"+item.filename,
	"preview_file_url": "/img/thumb/"+item.filename
       };
}

// Effing Anime boxes on iPad...
app.get("/data/*", parse, function(req,res) {
  if(req.params[0] == "sample") { // data/sample
    req.params[0] = req.params[1].replace("sample-","");
  }
  if(req.params[0].indexOf(".") > 0) {
    var md5 = req.params[0].split(".")[0];
    if(md5
    imageDB.getByHash(md5, function(err, image) {
      if(image != null) {
        res.redirect("/img/src/"+image.filename);
      } else res.send(404, "Not found!");
    });
  } else res.send(404, "Not found!");
});
app.get("/ssd/data/preview/*", parse, function(req,res) {
  if(req.params[0].indexOf(".") > 0) {
    var md5 = req.params[0].split(".")[0];
    imageDB.getByHash(md5, function(err, image) {
      if(image != null) {
        res.redirect("/img/thumb/"+image.filename);
      } else res.send(404, "Not found!");
    });
  } else res.send(404, "Not found!");
});

function sendDanbooruTable(req, res, images, options) {
  getImageTable(req,images,options,function(images2) {
    async.map(images2, function(item, callback) {
      callback(null, toDanbooruFormat(item));	
    }, function(err, results) {
      res.json(results);
    });
  });
}
app.get("/posts.json", function(req,res) {
  imageDB.images(function(images) {
    var onePageSize = (_.isNumber(req.query["limit"]) ? Math.min(config.maxPageSize,req.query["limit"]) : config.pageSize);
    var pageNumber = (req.query["page"] || 1)-1;
    var options = {
	"length": onePageSize,
        "start": pageNumber*onePageSize
    };
    var tags = [];
    if(_.isString(req.query["tags"]) && req.query["tags"] != "*" && req.query["tags"] != "") {
      var oldTags = req.query["tags"].split(" ");
      _.each(oldTags, function(tag) {
        if(tag != "" && !(_.startsWith(tag,"rating"))) {
          tags.push(tag);
        }
      });
    }
    if(tags.length > 0) {
      var query = queryParser.parse(tags.join(" "));
      if(options["start"] > 0) res.json([])
      else getSearchTable(req, query, function(result) {
        sendDanbooruTable(req, res, result, {"start": 0, "length": result.length});
      });
    } else sendDanbooruTable(req, res, images, options);
  });
});
