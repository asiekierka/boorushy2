var _ = require('underscore')
  , QueryParser = {};

var typeParsers = {
  "numeric": /^([a-z]+)([<=>]=?)([0-9]+)$/,
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
  "=": "eq",
  "==": "eq"
};

QueryParser.check = function(valueT,sign,value) {
  if((sign == "lt" && valueT < value)
     || (sign == "gt" && valueT > value)
     || (sign == "le" && valueT <= value)
     || (sign == "ge" && valueT >= value)
     || (sign == "eq" && valueT == value)) return true;
  return false;
}

QueryParser.handleNumeric = function(sign, pin) {
  var pmin = 0, pmax = 2147483647;
  if(sign == "eq") { pmin = pin; pmax = pin; }
  else if(sign == "lt") { pmax = pin-1; } else if(sign == "le") { pmax = pin; }
  else if(sign == "gt") { pmin = pin+1; } else if(sign == "ge") { pmin = pin; }
  return {"min": pmin, "max": pmax};
}
QueryParser.handleLinker = function(link, p1, p2) {
  if(link == "or") return _.union(p1,p2);
  else if(link == "and") return _.intersection(p1,p2);
  else if(link == "xor") {
    var p3 = [];
    _.each(_.union(p1,p2),function(val) {
      if(_.contains(p1,val) != _.contains(p2,val)) p3.push(val);
    });
    return p3;
  }
  else return [];
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
  var resultSorted = [];
  _.each(result, function(r) {
    var last = resultSorted.length-1;
    // join tag names
    if(last>=0 && resultSorted[last].type == "tag" && r.type == "tag")
      resultSorted[last].key = resultSorted[last].key + " " + (r.invert ? "!" : "") + r.key;
    else resultSorted.push(r);
  });
  var rpnStack = [], rpnResult = [], lStack = [], nums = 0;
  _.each(resultSorted, function(r) {
    if(r.type=="linker") lStack.push(r);
    else { rpnStack.push(r); nums++; }
    if(nums == 2 && lStack.length>0) {
      nums--; rpnStack.push(lStack.pop());
    }
  });
  _.each(lStack, function(r) { rpnStack.push(r); });
  return rpnStack;
};

exports.QueryParser = QueryParser;

// Test!
//console.log(QueryParser.parse("big tags and friendship or !magic and width>1920 & author=brony"));
