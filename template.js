var _ = require("underscore")
  , fs = require("fs")
  , templates = {}
  , skins = {}
  , _skin = "default";

_.each(fs.readdirSync("./skins/"), function(name) {
  var prefix = "./skins/"+name+"/";
  console.log("[Templater] Loading skin "+name);
  skins[name] = JSON.parse(fs.readFileSync(prefix+"skin.json","utf8"));
  skins[name].css = fs.readFileSync(prefix+"skin.css","utf8");
});

_.each(fs.readdirSync("./templates/"),function(filename) {
  var name = filename.split(".")[0];
  console.log("[Templater] Loading template "+name);
  templates[name] = _.template(fs.readFileSync("./templates/"+filename,"utf8"));
});

var skin = function(name) {
  if(_.isString(name))
    return skins[name];
  else _skin = name;
}
exports.skin = skin;
exports.get = function(name) {
  return templates[name];
}
exports.execute = function(name, config) {
  return templates[name](_.defaults(config, {skin: skin(_skin)}));
}
