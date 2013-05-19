var _ = require("underscore");

var defOptions = {
  "minFontSize": 10,
  "maxFontSize": 30,
  "template": "<a href='$TARGET' style='font-size: $SIZEpx' title='$COUNT times'>$TEXT</a>, ",
  "targetTemplate": "/tag/$TEXT",
  "alphaSort": true,
  "useLog": true
}

exports.generate = function(array, userOptions) {
  var nums = _.values(array)
    , tags = _.keys(array)
    , maxn = _.max(nums)
    , minn = _.min(nums)
    , options = _.defaults(userOptions, defOptions)
    , cloud = "";
  var multiplier = 0;
  if(options.useLog)
    multiplier = (options.maxFontSize - options.minFontSize) / (Math.log(maxn) - Math.log(minn));
  else 
    multiplier = (options.maxFontSize - options.minFontSize) / (maxn - minn);
  if(options.alphaSort) tags = tags.sort();
  _.each(tags, function(tag) {
    var val = (options.useLog ? Math.log(array[tag]) : array[tag]);
    var target = options.targetTemplate.replace("$TEXT",tag);
    var tag = options.template.replace("$TEXT",tag)
              .replace("$COUNT",array[tag])
              .replace("$SIZE",(options.minFontSize + (val*multiplier)))
              .replace("$TARGET",target);
    cloud += tag;
  });
  return cloud;
}
