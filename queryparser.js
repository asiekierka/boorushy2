var _ = require('underscore')
  , QueryParser = {};

var typeParsers = {
  "numeric": /^([a-z]+)([<=>])([0-9]+)$/,
  "string": /^([a-z]+)(=)([a-zA-Z0-9]+)$/,
  "tag": /^(!?)([-a-z0-9 _]+)$/
};

var linkers = {
  "&": "and",
  "|": "or",
  "^": "xor"
};

var signs = {
  "<": "lt",
  ">": "gt",
  "<=": "le",
  ">=": "ge",
  "=": "eq"
};

QueryParser.check = function(valueT,sign,value) {
  if((sign == "lt" && valueT < value)
     || (sign == "gt" && valueT > value)
     || (sign == "le" && valueT <= value)
     || (sign == "ge" && valueT >= value)
     || (sign == "eq" && valueT == value)) return true;
  return false;
}

// INTERNAL OPTIMIZATION STUFF
var lKeys = _(linkers).keys()
  , lValues = _(linkers).values();

QueryParser.parse = function(query) {
  var result = []
    , elements = query.replace(/, /g," | ").split(" ");
  _.each(elements, function(value) {
    var r = {};
    // Check the linkers
    if(_(lKeys).contains(value))
      { r.type = "linker"; r.link = linkers[value]; }
    else if(_(lValues).contains(value))
      { r.type = "linker"; r.link = value; }
    else  // It's a type!
      _.each(typeParsers, function(re, type) {
        if(r.type) return; // Skip if already typed.
        var exec = re.exec(value);
        if(exec) {
          r.type = type;
          if(type == "tag") {
            r.key = exec[2];
            r.invert = (exec[1]=="!")?true:false;
          } else {
            r.key = exec[1];
            if(exec.length>2) {
              r.sign = signs[exec[2]];
              r.value = exec[3];
            }
          }
        }
      });
    if(r != {}) result.push(r);
  });
  var rpnResult = [], lStack = [], nums = 0;
  _.each(result, function(r) {
    if(r.type=="linker") lStack.push(r);
    else { rpnResult.push(r); nums++; }
    if(nums == 2 && lStack.length>0) {
      nums--; rpnResult.push(lStack.pop());
    }
  });
  _.each(lStack, function(r) { rpnResult.push(r); });
  return rpnResult;
};

exports.QueryParser = QueryParser;

// Test!
console.log(QueryParser.parse("tags and friendship or !magic and width>1920 & author=brony"));
