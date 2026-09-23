// Dafny program the_program compiled into JavaScript
// Copyright by the contributors to the Dafny Project
// SPDX-License-Identifier: MIT

const BigNumber = require('bignumber.js');
BigNumber.config({ MODULO_MODE: BigNumber.EUCLID })
let _dafny = (function() {
  let $module = {};
  $module.areEqual = function(a, b) {
    if (typeof a === 'string' && b instanceof _dafny.Seq) {
      // Seq.equals(string) works as expected,
      // and the catch-all else block handles that direction.
      // But the opposite direction doesn't work; handle it here.
      return b.equals(a);
    } else if (typeof a === 'number' && BigNumber.isBigNumber(b)) {
      // This conditional would be correct even without the `typeof a` part,
      // but in most cases it's probably faster to short-circuit on a `typeof`
      // than to call `isBigNumber`. (But it remains to properly test this.)
      return b.isEqualTo(a);
    } else if (typeof a !== 'object' || a === null || b === null) {
      return a === b;
    } else if (BigNumber.isBigNumber(a)) {
      return a.isEqualTo(b);
    } else if (a._tname !== undefined || (Array.isArray(a) && a.constructor.name == "Array")) {
      return a === b;  // pointer equality
    } else {
      return a.equals(b);  // value-type equality
    }
  }
  $module.toString = function(a) {
    if (a === null) {
      return "null";
    } else if (typeof a === "number") {
      return a.toFixed();
    } else if (BigNumber.isBigNumber(a)) {
      return a.toFixed();
    } else if (a._tname !== undefined) {
      return a._tname;
    } else {
      return a.toString();
    }
  }
  $module.escapeCharacter = function(cp) {
    let s = String.fromCodePoint(cp.value)
    switch (s) {
      case '\n': return "\\n";
      case '\r': return "\\r";
      case '\t': return "\\t";
      case '\0': return "\\0";
      case '\'': return "\\'";
      case '\"': return "\\\"";
      case '\\': return "\\\\";
      default: return s;
    };
  }
  $module.NewObject = function() {
    return { _tname: "object" };
  }
  $module.InstanceOfTrait = function(obj, trait) {
    return obj._parentTraits !== undefined && obj._parentTraits().includes(trait);
  }
  $module.Rtd_bool = class {
    static get Default() { return false; }
  }
  $module.Rtd_char = class {
    static get Default() { return 'D'; }  // See CharType.DefaultValue in Dafny source code
  }
  $module.Rtd_codepoint = class {
    static get Default() { return new _dafny.CodePoint('D'.codePointAt(0)); }
  }
  $module.Rtd_int = class {
    static get Default() { return BigNumber(0); }
  }
  $module.Rtd_number = class {
    static get Default() { return 0; }
  }
  $module.Rtd_ref = class {
    static get Default() { return null; }
  }
  $module.Rtd_array = class {
    static get Default() { return []; }
  }
  $module.ZERO = new BigNumber(0);
  $module.ONE = new BigNumber(1);
  $module.NUMBER_LIMIT = new BigNumber(0x20).multipliedBy(0x1000000000000);  // 2^53
  $module.Tuple = class Tuple extends Array {
    constructor(...elems) {
      super(...elems);
    }
    toString() {
      return "(" + arrayElementsToString(this) + ")";
    }
    equals(other) {
      if (this === other) {
        return true;
      }
      for (let i = 0; i < this.length; i++) {
        if (!_dafny.areEqual(this[i], other[i])) {
          return false;
        }
      }
      return true;
    }
    static Default(...values) {
      return Tuple.of(...values);
    }
    static Rtd(...rtdArgs) {
      return {
        Default: Tuple.from(rtdArgs, rtd => rtd.Default)
      };
    }
  }
  $module.Set = class Set extends Array {
    constructor() {
      super();
    }
    static get Default() {
      return Set.Empty;
    }
    toString() {
      return "{" + arrayElementsToString(this) + "}";
    }
    static get Empty() {
      if (this._empty === undefined) {
        this._empty = new Set();
      }
      return this._empty;
    }
    static fromElements(...elmts) {
      let s = new Set();
      for (let k of elmts) {
        s.add(k);
      }
      return s;
    }
    contains(k) {
      for (let i = 0; i < this.length; i++) {
        if (_dafny.areEqual(this[i], k)) {
          return true;
        }
      }
      return false;
    }
    add(k) {  // mutates the Set; use only during construction
      if (!this.contains(k)) {
        this.push(k);
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.length !== other.length) {
        return false;
      }
      for (let e of this) {
        if (!other.contains(e)) {
          return false;
        }
      }
      return true;
    }
    get Elements() {
      return this;
    }
    Union(that) {
      if (this.length === 0) {
        return that;
      } else if (that.length === 0) {
        return this;
      } else {
        let s = Set.of(...this);
        for (let k of that) {
          s.add(k);
        }
        return s;
      }
    }
    Intersect(that) {
      if (this.length === 0) {
        return this;
      } else if (that.length === 0) {
        return that;
      } else {
        let s = new Set();
        for (let k of this) {
          if (that.contains(k)) {
            s.push(k);
          }
        }
        return s;
      }
    }
    Difference(that) {
      if (this.length == 0 || that.length == 0) {
        return this;
      } else {
        let s = new Set();
        for (let k of this) {
          if (!that.contains(k)) {
            s.push(k);
          }
        }
        return s;
      }
    }
    IsDisjointFrom(that) {
      for (let k of this) {
        if (that.contains(k)) {
          return false;
        }
      }
      return true;
    }
    IsSubsetOf(that) {
      if (that.length < this.length) {
        return false;
      }
      for (let k of this) {
        if (!that.contains(k)) {
          return false;
        }
      }
      return true;
    }
    IsProperSubsetOf(that) {
      if (that.length <= this.length) {
        return false;
      }
      for (let k of this) {
        if (!that.contains(k)) {
          return false;
        }
      }
      return true;
    }
    get AllSubsets() {
      return this.AllSubsets_();
    }
    *AllSubsets_() {
      // Start by putting all set elements into a list, but don't include null
      let elmts = Array.of(...this);
      let n = elmts.length;
      let which = new Array(n);
      which.fill(false);
      let a = [];
      while (true) {
        yield Set.of(...a);
        // "add 1" to "which", as if doing a carry chain.  For every digit changed, change the membership of the corresponding element in "a".
        let i = 0;
        for (; i < n && which[i]; i++) {
          which[i] = false;
          // remove elmts[i] from a
          for (let j = 0; j < a.length; j++) {
            if (_dafny.areEqual(a[j], elmts[i])) {
              // move the last element of a into slot j
              a[j] = a[-1];
              a.pop();
              break;
            }
          }
        }
        if (i === n) {
          // we have cycled through all the subsets
          break;
        }
        which[i] = true;
        a.push(elmts[i]);
      }
    }
  }
  $module.MultiSet = class MultiSet extends Array {
    constructor() {
      super();
    }
    static get Default() {
      return MultiSet.Empty;
    }
    toString() {
      let s = "multiset{";
      let sep = "";
      for (let e of this) {
        let [k, n] = e;
        let ks = _dafny.toString(k);
        while (!n.isZero()) {
          n = n.minus(1);
          s += sep + ks;
          sep = ", ";
        }
      }
      s += "}";
      return s;
    }
    static get Empty() {
      if (this._empty === undefined) {
        this._empty = new MultiSet();
      }
      return this._empty;
    }
    static fromElements(...elmts) {
      let s = new MultiSet();
      for (let e of elmts) {
        s.add(e, _dafny.ONE);
      }
      return s;
    }
    static FromArray(arr) {
      let s = new MultiSet();
      for (let e of arr) {
        s.add(e, _dafny.ONE);
      }
      return s;
    }
    cardinality() {
      let c = _dafny.ZERO;
      for (let e of this) {
        let [k, n] = e;
        c = c.plus(n);
      }
      return c;
    }
    clone() {
      let s = new MultiSet();
      for (let e of this) {
        let [k, n] = e;
        s.push([k, n]);  // make sure to create a new array [k, n] here
      }
      return s;
    }
    findIndex(k) {
      for (let i = 0; i < this.length; i++) {
        if (_dafny.areEqual(this[i][0], k)) {
          return i;
        }
      }
      return this.length;
    }
    get(k) {
      let i = this.findIndex(k);
      if (i === this.length) {
        return _dafny.ZERO;
      } else {
        return this[i][1];
      }
    }
    contains(k) {
      return !this.get(k).isZero();
    }
    add(k, n) {
      let i = this.findIndex(k);
      if (i === this.length) {
        this.push([k, n]);
      } else {
        let m = this[i][1];
        this[i] = [k, m.plus(n)];
      }
    }
    update(k, n) {
      let i = this.findIndex(k);
      if (i < this.length && this[i][1].isEqualTo(n)) {
        return this;
      } else if (i === this.length && n.isZero()) {
        return this;
      } else if (i === this.length) {
        let m = this.slice();
        m.push([k, n]);
        return m;
      } else {
        let m = this.slice();
        m[i] = [k, n];
        return m;
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      }
      for (let e of this) {
        let [k, n] = e;
        let m = other.get(k);
        if (!n.isEqualTo(m)) {
          return false;
        }
      }
      return this.cardinality().isEqualTo(other.cardinality());
    }
    get Elements() {
      return this.Elements_();
    }
    *Elements_() {
      for (let i = 0; i < this.length; i++) {
        let [k, n] = this[i];
        while (!n.isZero()) {
          yield k;
          n = n.minus(1);
        }
      }
    }
    get UniqueElements() {
      return this.UniqueElements_();
    }
    *UniqueElements_() {
      for (let e of this) {
        let [k, n] = e;
        if (!n.isZero()) {
          yield k;
        }
      }
    }
    Union(that) {
      if (this.length === 0) {
        return that;
      } else if (that.length === 0) {
        return this;
      } else {
        let s = this.clone();
        for (let e of that) {
          let [k, n] = e;
          s.add(k, n);
        }
        return s;
      }
    }
    Intersect(that) {
      if (this.length === 0) {
        return this;
      } else if (that.length === 0) {
        return that;
      } else {
        let s = new MultiSet();
        for (let e of this) {
          let [k, n] = e;
          let m = that.get(k);
          if (!m.isZero()) {
            s.push([k, m.isLessThan(n) ? m : n]);
          }
        }
        return s;
      }
    }
    Difference(that) {
      if (this.length === 0 || that.length === 0) {
        return this;
      } else {
        let s = new MultiSet();
        for (let e of this) {
          let [k, n] = e;
          let d = n.minus(that.get(k));
          if (d.isGreaterThan(0)) {
            s.push([k, d]);
          }
        }
        return s;
      }
    }
    IsDisjointFrom(that) {
      let intersection = this.Intersect(that);
      return intersection.cardinality().isZero();
    }
    IsSubsetOf(that) {
      for (let e of this) {
        let [k, n] = e;
        let m = that.get(k);
        if (!n.isLessThanOrEqualTo(m)) {
          return false;
        }
      }
      return true;
    }
    IsProperSubsetOf(that) {
      return this.IsSubsetOf(that) && this.cardinality().isLessThan(that.cardinality());
    }
  }
  $module.CodePoint = class CodePoint {
    constructor(value) {
      this.value = value
    }
    equals(other) {
      if (this === other) {
        return true;
      }
      return this.value === other.value
    }
    isLessThan(other) {
      return this.value < other.value
    }
    isLessThanOrEqual(other) {
      return this.value <= other.value
    }
    toString() {
      return "'" + $module.escapeCharacter(this) + "'";
    }
    static isCodePoint(i) {
      return (
        (_dafny.ZERO.isLessThanOrEqualTo(i) && i.isLessThan(new BigNumber(0xD800))) ||
        (new BigNumber(0xE000).isLessThanOrEqualTo(i) && i.isLessThan(new BigNumber(0x11_0000))))
    }
  }
  $module.Seq = class Seq extends Array {
    constructor(...elems) {
      super(...elems);
    }
    static get Default() {
      return Seq.of();
    }
    static Create(n, init) {
      return Seq.from({length: n}, (_, i) => init(new BigNumber(i)));
    }
    static UnicodeFromString(s) {
      return new Seq(...([...s].map(c => new _dafny.CodePoint(c.codePointAt(0)))))
    }
    toString() {
      return "[" + arrayElementsToString(this) + "]";
    }
    toVerbatimString(asLiteral) {
      if (asLiteral) {
        return '"' + this.map(c => _dafny.escapeCharacter(c)).join("") + '"';
      } else {
        return this.map(c => String.fromCodePoint(c.value)).join("");
      }
    }
    static update(s, i, v) {
      if (typeof s === "string") {
        let p = s.slice(0, i);
        let q = s.slice(i.toNumber() + 1);
        return p.concat(v, q);
      } else {
        let t = s.slice();
        t[i] = v;
        return t;
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.length !== other.length) {
        return false;
      }
      for (let i = 0; i < this.length; i++) {
        if (!_dafny.areEqual(this[i], other[i])) {
          return false;
        }
      }
      return true;
    }
    static contains(s, k) {
      if (typeof s === "string") {
        return s.includes(k);
      } else {
        for (let x of s) {
          if (_dafny.areEqual(x, k)) {
            return true;
          }
        }
        return false;
      }
    }
    get Elements() {
      return this;
    }
    get UniqueElements() {
      return _dafny.Set.fromElements(...this);
    }
    static Concat(a, b) {
      if (typeof a === "string" || typeof b === "string") {
        // string concatenation, so make sure both operands are strings before concatenating
        if (typeof a !== "string") {
          // a must be a Seq
          a = a.join("");
        }
        if (typeof b !== "string") {
          // b must be a Seq
          b = b.join("");
        }
        return a + b;
      } else {
        // ordinary concatenation
        let r = Seq.of(...a);
        r.push(...b);
        return r;
      }
    }
    static JoinIfPossible(x) {
      try { return x.join(""); } catch(_error) { return x; }
    }
    static IsPrefixOf(a, b) {
      if (b.length < a.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!_dafny.areEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
    static IsProperPrefixOf(a, b) {
      if (b.length <= a.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!_dafny.areEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }
  }
  $module.Map = class Map extends Array {
    constructor() {
      super();
    }
    static get Default() {
      return Map.of();
    }
    toString() {
      return "map[" + this.map(maplet => _dafny.toString(maplet[0]) + " := " + _dafny.toString(maplet[1])).join(", ") + "]";
    }
    static get Empty() {
      if (this._empty === undefined) {
        this._empty = new Map();
      }
      return this._empty;
    }
    findIndex(k) {
      for (let i = 0; i < this.length; i++) {
        if (_dafny.areEqual(this[i][0], k)) {
          return i;
        }
      }
      return this.length;
    }
    get(k) {
      let i = this.findIndex(k);
      if (i === this.length) {
        return undefined;
      } else {
        return this[i][1];
      }
    }
    contains(k) {
      return this.findIndex(k) < this.length;
    }
    update(k, v) {
      let m = this.slice();
      m.updateUnsafe(k, v);
      return m;
    }
    // Similar to update, but make the modification in-place.
    // Meant to be used in the map constructor.
    updateUnsafe(k, v) {
      let m = this;
      let i = m.findIndex(k);
      m[i] = [k, v];
      return m;
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.length !== other.length) {
        return false;
      }
      for (let e of this) {
        let [k, v] = e;
        let w = other.get(k);
        if (w === undefined || !_dafny.areEqual(v, w)) {
          return false;
        }
      }
      return true;
    }
    get Keys() {
      let s = new _dafny.Set();
      for (let e of this) {
        let [k, v] = e;
        s.push(k);
      }
      return s;
    }
    get Values() {
      let s = new _dafny.Set();
      for (let e of this) {
        let [k, v] = e;
        s.add(v);
      }
      return s;
    }
    get Items() {
      let s = new _dafny.Set();
      for (let e of this) {
        let [k, v] = e;
        s.push(_dafny.Tuple.of(k, v));
      }
      return s;
    }
    Merge(that) {
      let m = that.slice();
      for (let e of this) {
        let [k, v] = e;
        let i = m.findIndex(k);
        if (i == m.length) {
          m[i] = [k, v];
        }
      }
      return m;
    }
    Subtract(keys) {
      if (this.length === 0 || keys.length === 0) {
        return this;
      }
      let m = new Map();
      for (let e of this) {
        let [k, v] = e;
        if (!keys.contains(k)) {
          m[m.length] = e;
        }
      }
      return m;
    }
  }
  $module.newArray = function(initValue, ...dims) {
    return { dims: dims, elmts: buildArray(initValue, ...dims) };
  }
  $module.BigOrdinal = class BigOrdinal {
    static get Default() {
      return _dafny.ZERO;
    }
    static IsLimit(ord) {
      return ord.isZero();
    }
    static IsSucc(ord) {
      return ord.isGreaterThan(0);
    }
    static Offset(ord) {
      return ord;
    }
    static IsNat(ord) {
      return true;  // at run time, every ORDINAL is a natural number
    }
  }
  $module.BigRational = class BigRational {
    static get ZERO() {
      if (this._zero === undefined) {
        this._zero = new BigRational(_dafny.ZERO);
      }
      return this._zero;
    }
    constructor (n, d) {
      // requires d === undefined || 1 <= d
      this.num = n;
      this.den = d === undefined ? _dafny.ONE : d;
      // invariant 1 <= den || (num == 0 && den == 0)
    }
    static get Default() {
      return _dafny.BigRational.ZERO;
    }
    // We need to deal with the special case `num == 0 && den == 0`, because
    // that's what C#'s default struct constructor will produce for BigRational. :(
    // To deal with it, we ignore `den` when `num` is 0.
    toString() {
      if (this.num.isZero() || this.den.isEqualTo(1)) {
        return this.num.toFixed() + ".0";
      }
      let answer = this.dividesAPowerOf10(this.den);
      if (answer !== undefined) {
        let n = this.num.multipliedBy(answer[0]);
        let log10 = answer[1];
        let sign, digits;
        if (this.num.isLessThan(0)) {
          sign = "-"; digits = n.negated().toFixed();
        } else {
          sign = ""; digits = n.toFixed();
        }
        if (log10 < digits.length) {
          let digitCount = digits.length - log10;
          return sign + digits.slice(0, digitCount) + "." + digits.slice(digitCount);
        } else {
          return sign + "0." + "0".repeat(log10 - digits.length) + digits;
        }
      } else {
        return "(" + this.num.toFixed() + ".0 / " + this.den.toFixed() + ".0)";
      }
    }
    isPowerOf10(x) {
      if (x.isZero()) {
        return undefined;
      }
      let log10 = 0;
      while (true) {  // invariant: x != 0 && x * 10^log10 == old(x)
        if (x.isEqualTo(1)) {
          return log10;
        } else if (x.mod(10).isZero()) {
          log10++;
          x = x.dividedToIntegerBy(10);
        } else {
          return undefined;
        }
      }
    }
    dividesAPowerOf10(i) {
      let factor = _dafny.ONE;
      let log10 = 0;
      if (i.isLessThanOrEqualTo(_dafny.ZERO)) {
        return undefined;
      }

      // invariant: 1 <= i && i * 10^log10 == factor * old(i)
      while (i.mod(10).isZero()) {
        i = i.dividedToIntegerBy(10);
       log10++;
      }

      while (i.mod(5).isZero()) {
        i = i.dividedToIntegerBy(5);
        factor = factor.multipliedBy(2);
        log10++;
      }
      while (i.mod(2).isZero()) {
        i = i.dividedToIntegerBy(2);
        factor = factor.multipliedBy(5);
        log10++;
      }

      if (i.isEqualTo(_dafny.ONE)) {
        return [factor, log10];
      } else {
        return undefined;
      }
    }
    toBigNumber() {
      if (this.num.isZero() || this.den.isEqualTo(1)) {
        return this.num;
      } else if (this.num.isGreaterThan(0)) {
        return this.num.dividedToIntegerBy(this.den);
      } else {
        return this.num.minus(this.den).plus(1).dividedToIntegerBy(this.den);
      }
    }
    isInteger() {
      return this.equals(new _dafny.BigRational(this.toBigNumber(), _dafny.ONE));
    }
    // Returns values such that aa/dd == a and bb/dd == b.
    normalize(b) {
      let a = this;
      let aa, bb, dd;
      if (a.num.isZero()) {
        aa = a.num;
        bb = b.num;
        dd = b.den;
      } else if (b.num.isZero()) {
        aa = a.num;
        dd = a.den;
        bb = b.num;
      } else {
        let gcd = BigNumberGcd(a.den, b.den);
        let xx = a.den.dividedToIntegerBy(gcd);
        let yy = b.den.dividedToIntegerBy(gcd);
        // We now have a == a.num / (xx * gcd) and b == b.num / (yy * gcd).
        aa = a.num.multipliedBy(yy);
        bb = b.num.multipliedBy(xx);
        dd = a.den.multipliedBy(yy);
      }
      return [aa, bb, dd];
    }
    compareTo(that) {
      // simple things first
      let asign = this.num.isZero() ? 0 : this.num.isLessThan(0) ? -1 : 1;
      let bsign = that.num.isZero() ? 0 : that.num.isLessThan(0) ? -1 : 1;
      if (asign < 0 && 0 <= bsign) {
        return -1;
      } else if (asign <= 0 && 0 < bsign) {
        return -1;
      } else if (bsign < 0 && 0 <= asign) {
        return 1;
      } else if (bsign <= 0 && 0 < asign) {
        return 1;
      }
      let [aa, bb, dd] = this.normalize(that);
      if (aa.isLessThan(bb)) {
        return -1;
      } else if (aa.isEqualTo(bb)){
        return 0;
      } else {
        return 1;
      }
    }
    equals(that) {
      return this.compareTo(that) === 0;
    }
    isLessThan(that) {
      return this.compareTo(that) < 0;
    }
    isAtMost(that) {
      return this.compareTo(that) <= 0;
    }
    plus(b) {
      let [aa, bb, dd] = this.normalize(b);
      return new BigRational(aa.plus(bb), dd);
    }
    minus(b) {
      let [aa, bb, dd] = this.normalize(b);
      return new BigRational(aa.minus(bb), dd);
    }
    negated() {
      return new BigRational(this.num.negated(), this.den);
    }
    multipliedBy(b) {
      return new BigRational(this.num.multipliedBy(b.num), this.den.multipliedBy(b.den));
    }
    dividedBy(b) {
      let a = this;
      // Compute the reciprocal of b
      let bReciprocal;
      if (b.num.isGreaterThan(0)) {
        bReciprocal = new BigRational(b.den, b.num);
      } else {
        // this is the case b.num < 0
        bReciprocal = new BigRational(b.den.negated(), b.num.negated());
      }
      return a.multipliedBy(bReciprocal);
    }
  }
  $module.EuclideanDivisionNumber = function(a, b) {
    if (0 <= a) {
      if (0 <= b) {
        // +a +b: a/b
        return Math.floor(a / b);
      } else {
        // +a -b: -(a/(-b))
        return -Math.floor(a / -b);
      }
    } else {
      if (0 <= b) {
        // -a +b: -((-a-1)/b) - 1
        return -Math.floor((-a-1) / b) - 1;
      } else {
        // -a -b: ((-a-1)/(-b)) + 1
        return Math.floor((-a-1) / -b) + 1;
      }
    }
  }
  $module.EuclideanDivision = function(a, b) {
    if (a.isGreaterThanOrEqualTo(0)) {
      if (b.isGreaterThanOrEqualTo(0)) {
        // +a +b: a/b
        return a.dividedToIntegerBy(b);
      } else {
        // +a -b: -(a/(-b))
        return a.dividedToIntegerBy(b.negated()).negated();
      }
    } else {
      if (b.isGreaterThanOrEqualTo(0)) {
        // -a +b: -((-a-1)/b) - 1
        return a.negated().minus(1).dividedToIntegerBy(b).negated().minus(1);
      } else {
        // -a -b: ((-a-1)/(-b)) + 1
        return a.negated().minus(1).dividedToIntegerBy(b.negated()).plus(1);
      }
    }
  }
  $module.EuclideanModuloNumber = function(a, b) {
    let bp = Math.abs(b);
    if (0 <= a) {
      // +a: a % bp
      return a % bp;
    } else {
      // c = ((-a) % bp)
      // -a: bp - c if c > 0
      // -a: 0 if c == 0
      let c = (-a) % bp;
      return c === 0 ? c : bp - c;
    }
  }
  $module.ShiftLeft = function(b, n) {
    return b.multipliedBy(new BigNumber(2).exponentiatedBy(n));
  }
  $module.ShiftRight = function(b, n) {
    return b.dividedToIntegerBy(new BigNumber(2).exponentiatedBy(n));
  }
  $module.RotateLeft = function(b, n, w) {  // truncate(b << n) | (b >> (w - n))
    let x = _dafny.ShiftLeft(b, n).mod(new BigNumber(2).exponentiatedBy(w));
    let y = _dafny.ShiftRight(b, w - n);
    return x.plus(y);
  }
  $module.RotateRight = function(b, n, w) {  // (b >> n) | truncate(b << (w - n))
    let x = _dafny.ShiftRight(b, n);
    let y = _dafny.ShiftLeft(b, w - n).mod(new BigNumber(2).exponentiatedBy(w));;
    return x.plus(y);
  }
  $module.BitwiseAnd = function(a, b) {
    let r = _dafny.ZERO;
    const m = _dafny.NUMBER_LIMIT;  // 2^53
    let h = _dafny.ONE;
    while (!a.isZero() && !b.isZero()) {
      let a0 = a.mod(m);
      let b0 = b.mod(m);
      r = r.plus(h.multipliedBy(a0 & b0));
      a = a.dividedToIntegerBy(m);
      b = b.dividedToIntegerBy(m);
      h = h.multipliedBy(m);
    }
    return r;
  }
  $module.BitwiseOr = function(a, b) {
    let r = _dafny.ZERO;
    const m = _dafny.NUMBER_LIMIT;  // 2^53
    let h = _dafny.ONE;
    while (!a.isZero() && !b.isZero()) {
      let a0 = a.mod(m);
      let b0 = b.mod(m);
      r = r.plus(h.multipliedBy(a0 | b0));
      a = a.dividedToIntegerBy(m);
      b = b.dividedToIntegerBy(m);
      h = h.multipliedBy(m);
    }
    r = r.plus(h.multipliedBy(a | b));
    return r;
  }
  $module.BitwiseXor = function(a, b) {
    let r = _dafny.ZERO;
    const m = _dafny.NUMBER_LIMIT;  // 2^53
    let h = _dafny.ONE;
    while (!a.isZero() && !b.isZero()) {
      let a0 = a.mod(m);
      let b0 = b.mod(m);
      r = r.plus(h.multipliedBy(a0 ^ b0));
      a = a.dividedToIntegerBy(m);
      b = b.dividedToIntegerBy(m);
      h = h.multipliedBy(m);
    }
    r = r.plus(h.multipliedBy(a | b));
    return r;
  }
  $module.BitwiseNot = function(a, bits) {
    let r = _dafny.ZERO;
    let h = _dafny.ONE;
    for (let i = 0; i < bits; i++) {
      let bit = a.mod(2);
      if (bit.isZero()) {
        r = r.plus(h);
      }
      a = a.dividedToIntegerBy(2);
      h = h.multipliedBy(2);
    }
    return r;
  }
  $module.Quantifier = function(vals, frall, pred) {
    for (let u of vals) {
      if (pred(u) !== frall) { return !frall; }
    }
    return frall;
  }
  $module.PlusChar = function(a, b) {
    return String.fromCharCode(a.charCodeAt(0) + b.charCodeAt(0));
  }
  $module.UnicodePlusChar = function(a, b) {
    return new _dafny.CodePoint(a.value + b.value);
  }
  $module.MinusChar = function(a, b) {
    return String.fromCharCode(a.charCodeAt(0) - b.charCodeAt(0));
  }
  $module.UnicodeMinusChar = function(a, b) {
    return new _dafny.CodePoint(a.value - b.value);
  }
  $module.AllBooleans = function*() {
    yield false;
    yield true;
  }
  $module.AllChars = function*() {
    for (let i = 0; i < 0x10000; i++) {
      yield String.fromCharCode(i);
    }
  }
  $module.AllUnicodeChars = function*() {
    for (let i = 0; i < 0xD800; i++) {
      yield new _dafny.CodePoint(i);
    }
    for (let i = 0xE0000; i < 0x110000; i++) {
      yield new _dafny.CodePoint(i);
    }
  }
  $module.AllIntegers = function*() {
    yield _dafny.ZERO;
    for (let j = _dafny.ONE;; j = j.plus(1)) {
      yield j;
      yield j.negated();
    }
  }
  $module.IntegerRange = function*(lo, hi) {
    if (lo === null) {
      while (true) {
        hi = hi.minus(1);
        yield hi;
      }
    } else if (hi === null) {
      while (true) {
        yield lo;
        lo = lo.plus(1);
      }
    } else {
      while (lo.isLessThan(hi)) {
        yield lo;
        lo = lo.plus(1);
      }
    }
  }
  $module.SingleValue = function*(v) {
    yield v;
  }
  $module.HaltException = class HaltException extends Error {
    constructor(message) {
      super(message)
    }
  }
  $module.HandleHaltExceptions = function(f) {
    try {
      f()
    } catch (e) {
      if (e instanceof _dafny.HaltException) {
        process.stdout.write("[Program halted] " + e.message + "\n")
        process.exitCode = 1
      } else {
        throw e
      }
    }
  }
  $module.FromMainArguments = function(args) {
    var a = [...args];
    a.splice(0, 2, args[0] + " " + args[1]);
    return a;
  }
  $module.UnicodeFromMainArguments = function(args) {
    return $module.FromMainArguments(args).map(_dafny.Seq.UnicodeFromString);
  }
  return $module;

  // What follows are routines private to the Dafny runtime
  function buildArray(initValue, ...dims) {
    if (dims.length === 0) {
      return initValue;
    } else {
      let a = Array(dims[0].toNumber());
      let b = Array.from(a, (x) => buildArray(initValue, ...dims.slice(1)));
      return b;
    }
  }
  function arrayElementsToString(a) {
    // like `a.join(", ")`, but calling _dafny.toString(x) on every element x instead of x.toString()
    let s = "";
    let sep = "";
    for (let x of a) {
      s += sep + _dafny.toString(x);
      sep = ", ";
    }
    return s;
  }
  function BigNumberGcd(a, b){  // gcd of two non-negative BigNumber's
    while (true) {
      if (a.isZero()) {
        return b;
      } else if (b.isZero()) {
        return a;
      }
      if (a.isLessThan(b)) {
        b = b.modulo(a);
      } else {
        a = a.modulo(b);
      }
    }
  }
})();
// Dafny program systemModulePopulator.dfy compiled into JavaScript
let _System = (function() {
  let $module = {};

  $module.nat = class nat {
    constructor () {
    }
    static get Default() {
      return _dafny.ZERO;
    }
    static _Is(__source) {
      let _0_x = (__source);
      return (_dafny.ZERO).isLessThanOrEqualTo(_0_x);
    }
  };

  return $module;
})(); // end of module _System
let SkopAst = (function() {
  let $module = {};


  $module.Option = class Option {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_None() {
      let $dt = new Option(0);
      return $dt;
    }
    static create_Some(value) {
      let $dt = new Option(1);
      $dt.value = value;
      return $dt;
    }
    get is_None() { return this.$tag === 0; }
    get is_Some() { return this.$tag === 1; }
    get dtor_value() { return this.value; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Option.None";
      } else if (this.$tag === 1) {
        return "SkopAst.Option.Some" + "(" + _dafny.toString(this.value) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.value, other.value);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Option.create_None();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Option.Default();
        }
      };
    }
  }

  $module.Part = class Part {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Lit(s) {
      let $dt = new Part(0);
      $dt.s = s;
      return $dt;
    }
    static create_Var(name) {
      let $dt = new Part(1);
      $dt.name = name;
      return $dt;
    }
    get is_Lit() { return this.$tag === 0; }
    get is_Var() { return this.$tag === 1; }
    get dtor_s() { return this.s; }
    get dtor_name() { return this.name; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Part.Lit" + "(" + this.s.toVerbatimString(true) + ")";
      } else if (this.$tag === 1) {
        return "SkopAst.Part.Var" + "(" + this.name.toVerbatimString(true) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.s, other.s);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.name, other.name);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Part.create_Lit(_dafny.Seq.UnicodeFromString(""));
    }
    static Rtd() {
      return class {
        static get Default() {
          return Part.Default();
        }
      };
    }
  }

  $module.Anchor = class Anchor {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Anchor(given, expected) {
      let $dt = new Anchor(0);
      $dt.given = given;
      $dt.expected = expected;
      return $dt;
    }
    get is_Anchor() { return this.$tag === 0; }
    get dtor_given() { return this.given; }
    get dtor_expected() { return this.expected; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Anchor.Anchor" + "(" + this.given.toVerbatimString(true) + ", " + this.expected.toVerbatimString(true) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.given, other.given) && _dafny.areEqual(this.expected, other.expected);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Anchor.create_Anchor(_dafny.Seq.UnicodeFromString(""), _dafny.Seq.UnicodeFromString(""));
    }
    static Rtd() {
      return class {
        static get Default() {
          return Anchor.Default();
        }
      };
    }
  }

  $module.SectionRef = class SectionRef {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_SectionRef(id, anchor) {
      let $dt = new SectionRef(0);
      $dt.id = id;
      $dt.anchor = anchor;
      return $dt;
    }
    get is_SectionRef() { return this.$tag === 0; }
    get dtor_id() { return this.id; }
    get dtor_anchor() { return this.anchor; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.SectionRef.SectionRef" + "(" + this.id.toVerbatimString(true) + ", " + _dafny.toString(this.anchor) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.id, other.id) && _dafny.areEqual(this.anchor, other.anchor);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.SectionRef.create_SectionRef(_dafny.Seq.UnicodeFromString(""), SkopAst.Option.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return SectionRef.Default();
        }
      };
    }
  }

  $module.Else = class Else {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_NoElse() {
      let $dt = new Else(0);
      return $dt;
    }
    static create_Skip() {
      let $dt = new Else(1);
      return $dt;
    }
    static create_ElseTo(ref) {
      let $dt = new Else(2);
      $dt.ref = ref;
      return $dt;
    }
    get is_NoElse() { return this.$tag === 0; }
    get is_Skip() { return this.$tag === 1; }
    get is_ElseTo() { return this.$tag === 2; }
    get dtor_ref() { return this.ref; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Else.NoElse";
      } else if (this.$tag === 1) {
        return "SkopAst.Else.Skip";
      } else if (this.$tag === 2) {
        return "SkopAst.Else.ElseTo" + "(" + _dafny.toString(this.ref) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.ref, other.ref);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Else.create_NoElse();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Else.Default();
        }
      };
    }
  }

  $module.Target = class Target {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_StopTarget() {
      let $dt = new Target(0);
      return $dt;
    }
    static create_To(ref) {
      let $dt = new Target(1);
      $dt.ref = ref;
      return $dt;
    }
    get is_StopTarget() { return this.$tag === 0; }
    get is_To() { return this.$tag === 1; }
    get dtor_ref() { return this.ref; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Target.StopTarget";
      } else if (this.$tag === 1) {
        return "SkopAst.Target.To" + "(" + _dafny.toString(this.ref) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.ref, other.ref);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Target.create_StopTarget();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Target.Default();
        }
      };
    }
  }

  $module.DoBody = class DoBody {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_DoCmd(cmd) {
      let $dt = new DoBody(0);
      $dt.cmd = cmd;
      return $dt;
    }
    static create_DoItem(item) {
      let $dt = new DoBody(1);
      $dt.item = item;
      return $dt;
    }
    get is_DoCmd() { return this.$tag === 0; }
    get is_DoItem() { return this.$tag === 1; }
    get dtor_cmd() { return this.cmd; }
    get dtor_item() { return this.item; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.DoBody.DoCmd" + "(" + _dafny.toString(this.cmd) + ")";
      } else if (this.$tag === 1) {
        return "SkopAst.DoBody.DoItem" + "(" + this.item.toVerbatimString(true) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.cmd, other.cmd);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.item, other.item);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.DoBody.create_DoCmd(_dafny.Seq.of());
    }
    static Rtd() {
      return class {
        static get Default() {
          return DoBody.Default();
        }
      };
    }
  }

  $module.CmpOp = class CmpOp {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Lt() {
      let $dt = new CmpOp(0);
      return $dt;
    }
    static create_Le() {
      let $dt = new CmpOp(1);
      return $dt;
    }
    static create_Gt() {
      let $dt = new CmpOp(2);
      return $dt;
    }
    static create_Ge() {
      let $dt = new CmpOp(3);
      return $dt;
    }
    static create_Eq() {
      let $dt = new CmpOp(4);
      return $dt;
    }
    static create_Ne() {
      let $dt = new CmpOp(5);
      return $dt;
    }
    get is_Lt() { return this.$tag === 0; }
    get is_Le() { return this.$tag === 1; }
    get is_Gt() { return this.$tag === 2; }
    get is_Ge() { return this.$tag === 3; }
    get is_Eq() { return this.$tag === 4; }
    get is_Ne() { return this.$tag === 5; }
    static get AllSingletonConstructors() {
      return this.AllSingletonConstructors_();
    }
    static *AllSingletonConstructors_() {
      yield CmpOp.create_Lt();
      yield CmpOp.create_Le();
      yield CmpOp.create_Gt();
      yield CmpOp.create_Ge();
      yield CmpOp.create_Eq();
      yield CmpOp.create_Ne();
    }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.CmpOp.Lt";
      } else if (this.$tag === 1) {
        return "SkopAst.CmpOp.Le";
      } else if (this.$tag === 2) {
        return "SkopAst.CmpOp.Gt";
      } else if (this.$tag === 3) {
        return "SkopAst.CmpOp.Ge";
      } else if (this.$tag === 4) {
        return "SkopAst.CmpOp.Eq";
      } else if (this.$tag === 5) {
        return "SkopAst.CmpOp.Ne";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else if (this.$tag === 2) {
        return other.$tag === 2;
      } else if (this.$tag === 3) {
        return other.$tag === 3;
      } else if (this.$tag === 4) {
        return other.$tag === 4;
      } else if (this.$tag === 5) {
        return other.$tag === 5;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.CmpOp.create_Lt();
    }
    static Rtd() {
      return class {
        static get Default() {
          return CmpOp.Default();
        }
      };
    }
  }

  $module.Operand = class Operand {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_VarOp(name) {
      let $dt = new Operand(0);
      $dt.name = name;
      return $dt;
    }
    static create_Num(text) {
      let $dt = new Operand(1);
      $dt.text = text;
      return $dt;
    }
    get is_VarOp() { return this.$tag === 0; }
    get is_Num() { return this.$tag === 1; }
    get dtor_name() { return this.name; }
    get dtor_text() { return this.text; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Operand.VarOp" + "(" + this.name.toVerbatimString(true) + ")";
      } else if (this.$tag === 1) {
        return "SkopAst.Operand.Num" + "(" + this.text.toVerbatimString(true) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.name, other.name);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.text, other.text);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Operand.create_VarOp(_dafny.Seq.UnicodeFromString(""));
    }
    static Rtd() {
      return class {
        static get Default() {
          return Operand.Default();
        }
      };
    }
  }

  $module.Cond = class Cond {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Succeeds(cmd) {
      let $dt = new Cond(0);
      $dt.cmd = cmd;
      return $dt;
    }
    static create_Cmp(op, l, r) {
      let $dt = new Cond(1);
      $dt.op = op;
      $dt.l = l;
      $dt.r = r;
      return $dt;
    }
    get is_Succeeds() { return this.$tag === 0; }
    get is_Cmp() { return this.$tag === 1; }
    get dtor_cmd() { return this.cmd; }
    get dtor_op() { return this.op; }
    get dtor_l() { return this.l; }
    get dtor_r() { return this.r; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Cond.Succeeds" + "(" + _dafny.toString(this.cmd) + ")";
      } else if (this.$tag === 1) {
        return "SkopAst.Cond.Cmp" + "(" + _dafny.toString(this.op) + ", " + _dafny.toString(this.l) + ", " + _dafny.toString(this.r) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.cmd, other.cmd);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.op, other.op) && _dafny.areEqual(this.l, other.l) && _dafny.areEqual(this.r, other.r);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Cond.create_Succeeds(_dafny.Seq.of());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Cond.Default();
        }
      };
    }
  }

  $module.AskOption = class AskOption {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_AskOption(src, ref) {
      let $dt = new AskOption(0);
      $dt.src = src;
      $dt.ref = ref;
      return $dt;
    }
    get is_AskOption() { return this.$tag === 0; }
    get dtor_src() { return this.src; }
    get dtor_ref() { return this.ref; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.AskOption.AskOption" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.ref) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.ref, other.ref);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.AskOption.create_AskOption(_dafny.ZERO, SkopAst.SectionRef.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return AskOption.Default();
        }
      };
    }
  }

  $module.RubricLine = class RubricLine {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_RubricLine(src, level, text) {
      let $dt = new RubricLine(0);
      $dt.src = src;
      $dt.level = level;
      $dt.text = text;
      return $dt;
    }
    get is_RubricLine() { return this.$tag === 0; }
    get dtor_src() { return this.src; }
    get dtor_level() { return this.level; }
    get dtor_text() { return this.text; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.RubricLine.RubricLine" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.level) + ", " + this.text.toVerbatimString(true) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.level, other.level) && _dafny.areEqual(this.text, other.text);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.RubricLine.create_RubricLine(_dafny.ZERO, _dafny.ZERO, _dafny.Seq.UnicodeFromString(""));
    }
    static Rtd() {
      return class {
        static get Default() {
          return RubricLine.Default();
        }
      };
    }
  }

  $module.AskForm = class AskForm {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Sections(options) {
      let $dt = new AskForm(0);
      $dt.options = options;
      return $dt;
    }
    static create_YesNo(binding) {
      let $dt = new AskForm(1);
      $dt.binding = binding;
      return $dt;
    }
    static create_OneOf(list, binding) {
      let $dt = new AskForm(2);
      $dt.list = list;
      $dt.binding = binding;
      return $dt;
    }
    static create_Score(low, high, rubric, binding) {
      let $dt = new AskForm(3);
      $dt.low = low;
      $dt.high = high;
      $dt.rubric = rubric;
      $dt.binding = binding;
      return $dt;
    }
    get is_Sections() { return this.$tag === 0; }
    get is_YesNo() { return this.$tag === 1; }
    get is_OneOf() { return this.$tag === 2; }
    get is_Score() { return this.$tag === 3; }
    get dtor_options() { return this.options; }
    get dtor_binding() { return this.binding; }
    get dtor_list() { return this.list; }
    get dtor_low() { return this.low; }
    get dtor_high() { return this.high; }
    get dtor_rubric() { return this.rubric; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.AskForm.Sections" + "(" + _dafny.toString(this.options) + ")";
      } else if (this.$tag === 1) {
        return "SkopAst.AskForm.YesNo" + "(" + this.binding.toVerbatimString(true) + ")";
      } else if (this.$tag === 2) {
        return "SkopAst.AskForm.OneOf" + "(" + _dafny.toString(this.list) + ", " + this.binding.toVerbatimString(true) + ")";
      } else if (this.$tag === 3) {
        return "SkopAst.AskForm.Score" + "(" + _dafny.toString(this.low) + ", " + _dafny.toString(this.high) + ", " + _dafny.toString(this.rubric) + ", " + this.binding.toVerbatimString(true) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.options, other.options);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.binding, other.binding);
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.list, other.list) && _dafny.areEqual(this.binding, other.binding);
      } else if (this.$tag === 3) {
        return other.$tag === 3 && _dafny.areEqual(this.low, other.low) && _dafny.areEqual(this.high, other.high) && _dafny.areEqual(this.rubric, other.rubric) && _dafny.areEqual(this.binding, other.binding);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.AskForm.create_Sections(_dafny.Seq.of());
    }
    static Rtd() {
      return class {
        static get Default() {
          return AskForm.Default();
        }
      };
    }
  }

  $module.Stmt = class Stmt {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Run(src, cmd, binding, els) {
      let $dt = new Stmt(0);
      $dt.src = src;
      $dt.cmd = cmd;
      $dt.binding = binding;
      $dt.els = els;
      return $dt;
    }
    static create_Do(src, action, els) {
      let $dt = new Stmt(1);
      $dt.src = src;
      $dt.action = action;
      $dt.els = els;
      return $dt;
    }
    static create_Check(src, cond, onTrue, els) {
      let $dt = new Stmt(2);
      $dt.src = src;
      $dt.cond = cond;
      $dt.onTrue = onTrue;
      $dt.els = els;
      return $dt;
    }
    static create_Ask(src, question, sure, form, els) {
      let $dt = new Stmt(3);
      $dt.src = src;
      $dt.question = question;
      $dt.sure = sure;
      $dt.form = form;
      $dt.els = els;
      return $dt;
    }
    static create_ForEach(src, loopVar, list, body) {
      let $dt = new Stmt(4);
      $dt.src = src;
      $dt.loopVar = loopVar;
      $dt.list = list;
      $dt.body = body;
      return $dt;
    }
    static create_IfYesRun(src, cmd, els) {
      let $dt = new Stmt(5);
      $dt.src = src;
      $dt.cmd = cmd;
      $dt.els = els;
      return $dt;
    }
    static create_IfYesDo(src, action, els) {
      let $dt = new Stmt(6);
      $dt.src = src;
      $dt.action = action;
      $dt.els = els;
      return $dt;
    }
    static create_Then(src, ref) {
      let $dt = new Stmt(7);
      $dt.src = src;
      $dt.ref = ref;
      return $dt;
    }
    static create_Page(src, text) {
      let $dt = new Stmt(8);
      $dt.src = src;
      $dt.text = text;
      return $dt;
    }
    static create_HandOff(src) {
      let $dt = new Stmt(9);
      $dt.src = src;
      return $dt;
    }
    static create_Stop(src) {
      let $dt = new Stmt(10);
      $dt.src = src;
      return $dt;
    }
    get is_Run() { return this.$tag === 0; }
    get is_Do() { return this.$tag === 1; }
    get is_Check() { return this.$tag === 2; }
    get is_Ask() { return this.$tag === 3; }
    get is_ForEach() { return this.$tag === 4; }
    get is_IfYesRun() { return this.$tag === 5; }
    get is_IfYesDo() { return this.$tag === 6; }
    get is_Then() { return this.$tag === 7; }
    get is_Page() { return this.$tag === 8; }
    get is_HandOff() { return this.$tag === 9; }
    get is_Stop() { return this.$tag === 10; }
    get dtor_src() { return this.src; }
    get dtor_cmd() { return this.cmd; }
    get dtor_binding() { return this.binding; }
    get dtor_els() { return this.els; }
    get dtor_action() { return this.action; }
    get dtor_cond() { return this.cond; }
    get dtor_onTrue() { return this.onTrue; }
    get dtor_question() { return this.question; }
    get dtor_sure() { return this.sure; }
    get dtor_form() { return this.form; }
    get dtor_loopVar() { return this.loopVar; }
    get dtor_list() { return this.list; }
    get dtor_body() { return this.body; }
    get dtor_ref() { return this.ref; }
    get dtor_text() { return this.text; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Stmt.Run" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.cmd) + ", " + _dafny.toString(this.binding) + ", " + _dafny.toString(this.els) + ")";
      } else if (this.$tag === 1) {
        return "SkopAst.Stmt.Do" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.action) + ", " + _dafny.toString(this.els) + ")";
      } else if (this.$tag === 2) {
        return "SkopAst.Stmt.Check" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.cond) + ", " + _dafny.toString(this.onTrue) + ", " + _dafny.toString(this.els) + ")";
      } else if (this.$tag === 3) {
        return "SkopAst.Stmt.Ask" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.question) + ", " + _dafny.toString(this.sure) + ", " + _dafny.toString(this.form) + ", " + _dafny.toString(this.els) + ")";
      } else if (this.$tag === 4) {
        return "SkopAst.Stmt.ForEach" + "(" + _dafny.toString(this.src) + ", " + this.loopVar.toVerbatimString(true) + ", " + _dafny.toString(this.list) + ", " + _dafny.toString(this.body) + ")";
      } else if (this.$tag === 5) {
        return "SkopAst.Stmt.IfYesRun" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.cmd) + ", " + _dafny.toString(this.els) + ")";
      } else if (this.$tag === 6) {
        return "SkopAst.Stmt.IfYesDo" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.action) + ", " + _dafny.toString(this.els) + ")";
      } else if (this.$tag === 7) {
        return "SkopAst.Stmt.Then" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.ref) + ")";
      } else if (this.$tag === 8) {
        return "SkopAst.Stmt.Page" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.text) + ")";
      } else if (this.$tag === 9) {
        return "SkopAst.Stmt.HandOff" + "(" + _dafny.toString(this.src) + ")";
      } else if (this.$tag === 10) {
        return "SkopAst.Stmt.Stop" + "(" + _dafny.toString(this.src) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.cmd, other.cmd) && _dafny.areEqual(this.binding, other.binding) && _dafny.areEqual(this.els, other.els);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.action, other.action) && _dafny.areEqual(this.els, other.els);
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.cond, other.cond) && _dafny.areEqual(this.onTrue, other.onTrue) && _dafny.areEqual(this.els, other.els);
      } else if (this.$tag === 3) {
        return other.$tag === 3 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.question, other.question) && _dafny.areEqual(this.sure, other.sure) && _dafny.areEqual(this.form, other.form) && _dafny.areEqual(this.els, other.els);
      } else if (this.$tag === 4) {
        return other.$tag === 4 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.loopVar, other.loopVar) && _dafny.areEqual(this.list, other.list) && _dafny.areEqual(this.body, other.body);
      } else if (this.$tag === 5) {
        return other.$tag === 5 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.cmd, other.cmd) && _dafny.areEqual(this.els, other.els);
      } else if (this.$tag === 6) {
        return other.$tag === 6 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.action, other.action) && _dafny.areEqual(this.els, other.els);
      } else if (this.$tag === 7) {
        return other.$tag === 7 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.ref, other.ref);
      } else if (this.$tag === 8) {
        return other.$tag === 8 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.text, other.text);
      } else if (this.$tag === 9) {
        return other.$tag === 9 && _dafny.areEqual(this.src, other.src);
      } else if (this.$tag === 10) {
        return other.$tag === 10 && _dafny.areEqual(this.src, other.src);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Stmt.create_Run(_dafny.ZERO, _dafny.Seq.of(), SkopAst.Option.Default(), SkopAst.Else.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Stmt.Default();
        }
      };
    }
  }

  $module.Item = class Item {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Action(src, text, cmd) {
      let $dt = new Item(0);
      $dt.src = src;
      $dt.text = text;
      $dt.cmd = cmd;
      return $dt;
    }
    static create_Value(src, value) {
      let $dt = new Item(1);
      $dt.src = src;
      $dt.value = value;
      return $dt;
    }
    get is_Action() { return this.$tag === 0; }
    get is_Value() { return this.$tag === 1; }
    get dtor_src() { return this.src; }
    get dtor_text() { return this.text; }
    get dtor_cmd() { return this.cmd; }
    get dtor_value() { return this.value; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Item.Action" + "(" + _dafny.toString(this.src) + ", " + this.text.toVerbatimString(true) + ", " + _dafny.toString(this.cmd) + ")";
      } else if (this.$tag === 1) {
        return "SkopAst.Item.Value" + "(" + _dafny.toString(this.src) + ", " + this.value.toVerbatimString(true) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.text, other.text) && _dafny.areEqual(this.cmd, other.cmd);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.value, other.value);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Item.create_Action(_dafny.ZERO, _dafny.Seq.UnicodeFromString(""), _dafny.Seq.of());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Item.Default();
        }
      };
    }
  }

  $module.List = class List {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_List(src, items) {
      let $dt = new List(0);
      $dt.src = src;
      $dt.items = items;
      return $dt;
    }
    get is_List() { return this.$tag === 0; }
    get dtor_src() { return this.src; }
    get dtor_items() { return this.items; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.List.List" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.items) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.items, other.items);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.List.create_List(_dafny.ZERO, _dafny.Seq.of());
    }
    static Rtd() {
      return class {
        static get Default() {
          return List.Default();
        }
      };
    }
  }

  $module.Section = class Section {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Instructions(name, src, guidance, body) {
      let $dt = new Section(0);
      $dt.name = name;
      $dt.src = src;
      $dt.guidance = guidance;
      $dt.body = body;
      return $dt;
    }
    static create_Other(name, src, lists) {
      let $dt = new Section(1);
      $dt.name = name;
      $dt.src = src;
      $dt.lists = lists;
      return $dt;
    }
    get is_Instructions() { return this.$tag === 0; }
    get is_Other() { return this.$tag === 1; }
    get dtor_name() { return this.name; }
    get dtor_src() { return this.src; }
    get dtor_guidance() { return this.guidance; }
    get dtor_body() { return this.body; }
    get dtor_lists() { return this.lists; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Section.Instructions" + "(" + this.name.toVerbatimString(true) + ", " + _dafny.toString(this.src) + ", " + _dafny.toString(this.guidance) + ", " + _dafny.toString(this.body) + ")";
      } else if (this.$tag === 1) {
        return "SkopAst.Section.Other" + "(" + this.name.toVerbatimString(true) + ", " + _dafny.toString(this.src) + ", " + _dafny.toString(this.lists) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.name, other.name) && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.guidance, other.guidance) && _dafny.areEqual(this.body, other.body);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.name, other.name) && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.lists, other.lists);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Section.create_Instructions(_dafny.Seq.UnicodeFromString(""), _dafny.ZERO, SkopAst.Option.Default(), _dafny.Seq.of());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Section.Default();
        }
      };
    }
  }

  $module.Param = class Param {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_PStr(s, src) {
      let $dt = new Param(0);
      $dt.s = s;
      $dt.src = src;
      return $dt;
    }
    static create_PInt(i, src) {
      let $dt = new Param(1);
      $dt.i = i;
      $dt.src = src;
      return $dt;
    }
    get is_PStr() { return this.$tag === 0; }
    get is_PInt() { return this.$tag === 1; }
    get dtor_s() { return this.s; }
    get dtor_src() { return this.src; }
    get dtor_i() { return this.i; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Param.PStr" + "(" + this.s.toVerbatimString(true) + ", " + _dafny.toString(this.src) + ")";
      } else if (this.$tag === 1) {
        return "SkopAst.Param.PInt" + "(" + _dafny.toString(this.i) + ", " + _dafny.toString(this.src) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.s, other.s) && _dafny.areEqual(this.src, other.src);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.i, other.i) && _dafny.areEqual(this.src, other.src);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Param.create_PStr(_dafny.Seq.UnicodeFromString(""), _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Param.Default();
        }
      };
    }
  }

  $module.Limits = class Limits {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Limits(runTimeoutMs, doTimeoutMs, deadlineMs, askContextTokens) {
      let $dt = new Limits(0);
      $dt.runTimeoutMs = runTimeoutMs;
      $dt.doTimeoutMs = doTimeoutMs;
      $dt.deadlineMs = deadlineMs;
      $dt.askContextTokens = askContextTokens;
      return $dt;
    }
    get is_Limits() { return this.$tag === 0; }
    get dtor_runTimeoutMs() { return this.runTimeoutMs; }
    get dtor_doTimeoutMs() { return this.doTimeoutMs; }
    get dtor_deadlineMs() { return this.deadlineMs; }
    get dtor_askContextTokens() { return this.askContextTokens; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Limits.Limits" + "(" + _dafny.toString(this.runTimeoutMs) + ", " + _dafny.toString(this.doTimeoutMs) + ", " + _dafny.toString(this.deadlineMs) + ", " + _dafny.toString(this.askContextTokens) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.runTimeoutMs, other.runTimeoutMs) && _dafny.areEqual(this.doTimeoutMs, other.doTimeoutMs) && _dafny.areEqual(this.deadlineMs, other.deadlineMs) && _dafny.areEqual(this.askContextTokens, other.askContextTokens);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Limits.create_Limits(_dafny.ZERO, _dafny.ZERO, _dafny.ZERO, _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Limits.Default();
        }
      };
    }
  }

  $module.Entry = class Entry {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Entry(section, src) {
      let $dt = new Entry(0);
      $dt.section = section;
      $dt.src = src;
      return $dt;
    }
    get is_Entry() { return this.$tag === 0; }
    get dtor_section() { return this.section; }
    get dtor_src() { return this.src; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Entry.Entry" + "(" + this.section.toVerbatimString(true) + ", " + _dafny.toString(this.src) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.section, other.section) && _dafny.areEqual(this.src, other.src);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Entry.create_Entry(_dafny.Seq.UnicodeFromString(""), _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Entry.Default();
        }
      };
    }
  }

  $module.Program = class Program {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Program(skill, entry, params, limits, sections) {
      let $dt = new Program(0);
      $dt.skill = skill;
      $dt.entry = entry;
      $dt.params = params;
      $dt.limits = limits;
      $dt.sections = sections;
      return $dt;
    }
    get is_Program() { return this.$tag === 0; }
    get dtor_skill() { return this.skill; }
    get dtor_entry() { return this.entry; }
    get dtor_params() { return this.params; }
    get dtor_limits() { return this.limits; }
    get dtor_sections() { return this.sections; }
    toString() {
      if (this.$tag === 0) {
        return "SkopAst.Program.Program" + "(" + this.skill.toVerbatimString(true) + ", " + _dafny.toString(this.entry) + ", " + _dafny.toString(this.params) + ", " + _dafny.toString(this.limits) + ", " + _dafny.toString(this.sections) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.skill, other.skill) && _dafny.areEqual(this.entry, other.entry) && _dafny.areEqual(this.params, other.params) && _dafny.areEqual(this.limits, other.limits) && _dafny.areEqual(this.sections, other.sections);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopAst.Program.create_Program(_dafny.Seq.UnicodeFromString(""), SkopAst.Entry.Default(), _dafny.Map.Empty, SkopAst.Limits.Default(), _dafny.Map.Empty);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Program.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module SkopAst
let SkopWellFormed = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "SkopWellFormed._default";
    }
    _parentTraits() {
      return [];
    }
    static IsInstr(p, id) {
      return (((p).dtor_sections).contains(id)) && ((((p).dtor_sections).get(id)).is_Instructions);
    };
    static Body(p, id) {
      return (((p).dtor_sections).get(id)).dtor_body;
    };
    static IsData(p, id) {
      return ((((p).dtor_sections).contains(id)) && ((((p).dtor_sections).get(id)).is_Other)) && ((new BigNumber(((((p).dtor_sections).get(id)).dtor_lists).length)).isEqualTo(_dafny.ONE));
    };
    static DataList(p, id) {
      return ((((p).dtor_sections).get(id)).dtor_lists)[_dafny.ZERO];
    };
    static AnchorOk(r) {
      return (((r).dtor_anchor).is_None) || (_dafny.areEqual((((r).dtor_anchor).dtor_value).dtor_given, (((r).dtor_anchor).dtor_value).dtor_expected));
    };
    static Flat(body) {
      if ((new BigNumber((body).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Seq.of();
      } else {
        return _dafny.Seq.Concat(_dafny.Seq.Concat(_dafny.Seq.of((body)[_dafny.ZERO]), ((((body)[_dafny.ZERO]).is_ForEach) ? (SkopWellFormed.__default.Flat(((body)[_dafny.ZERO]).dtor_body)) : (_dafny.Seq.of()))), SkopWellFormed.__default.Flat((body).slice(_dafny.ONE)));
      }
    };
    static Stmts(p) {
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of ((p).dtor_sections).Keys.Elements) {
          let _0_id = _compr_0;
          if ((((p).dtor_sections).contains(_0_id)) && ((((p).dtor_sections).get(_0_id)).is_Instructions)) {
            for (const _compr_1 of (SkopWellFormed.__default.Flat((((p).dtor_sections).get(_0_id)).dtor_body)).Elements) {
              let _1_s = _compr_1;
              if (_dafny.Seq.contains(SkopWellFormed.__default.Flat((((p).dtor_sections).get(_0_id)).dtor_body), _1_s)) {
                _coll0.add(_1_s);
              }
            }
          }
        }
        return _coll0;
      }();
    };
    static ElseJump(e, src) {
      if ((e).is_ElseTo) {
        return _dafny.Set.fromElements(SkopWellFormed.Jump.create_Jump((e).dtor_ref, src));
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static Jumps(s) {
      let _source0 = s;
      {
        if (_source0.is_Run) {
          let _0_src = (_source0).src;
          let _1_els = (_source0).els;
          return SkopWellFormed.__default.ElseJump(_1_els, _0_src);
        }
      }
      {
        if (_source0.is_Do) {
          let _2_src = (_source0).src;
          let _3_els = (_source0).els;
          return SkopWellFormed.__default.ElseJump(_3_els, _2_src);
        }
      }
      {
        if (_source0.is_Check) {
          let _4_src = (_source0).src;
          let _5_onTrue = (_source0).onTrue;
          let _6_els = (_source0).els;
          return (((((_5_onTrue).is_Some) && (((_5_onTrue).dtor_value).is_To)) ? (_dafny.Set.fromElements(SkopWellFormed.Jump.create_Jump(((_5_onTrue).dtor_value).dtor_ref, _4_src))) : (_dafny.Set.fromElements()))).Union(SkopWellFormed.__default.ElseJump(_6_els, _4_src));
        }
      }
      {
        if (_source0.is_Ask) {
          let _7_src = (_source0).src;
          let _8_form = (_source0).form;
          let _9_els = (_source0).els;
          return ((((_8_form).is_Sections) ? (function () {
            let _coll0 = new _dafny.Set();
            for (const _compr_0 of _dafny.IntegerRange(_dafny.ZERO, new BigNumber(((_8_form).dtor_options).length))) {
              let _10_k = _compr_0;
              if (((_dafny.ZERO).isLessThanOrEqualTo(_10_k)) && ((_10_k).isLessThan(new BigNumber(((_8_form).dtor_options).length)))) {
                _coll0.add(SkopWellFormed.Jump.create_Jump((((_8_form).dtor_options)[_10_k]).dtor_ref, (((_8_form).dtor_options)[_10_k]).dtor_src));
              }
            }
            return _coll0;
          }()) : (_dafny.Set.fromElements()))).Union(SkopWellFormed.__default.ElseJump(_9_els, _7_src));
        }
      }
      {
        if (_source0.is_ForEach) {
          return _dafny.Set.fromElements();
        }
      }
      {
        if (_source0.is_IfYesRun) {
          let _11_src = (_source0).src;
          let _12_els = (_source0).els;
          return SkopWellFormed.__default.ElseJump(_12_els, _11_src);
        }
      }
      {
        if (_source0.is_IfYesDo) {
          let _13_src = (_source0).src;
          let _14_els = (_source0).els;
          return SkopWellFormed.__default.ElseJump(_14_els, _13_src);
        }
      }
      {
        if (_source0.is_Then) {
          let _15_src = (_source0).src;
          let _16_r = (_source0).ref;
          return _dafny.Set.fromElements(SkopWellFormed.Jump.create_Jump(_16_r, _15_src));
        }
      }
      {
        if (_source0.is_Page) {
          return _dafny.Set.fromElements();
        }
      }
      {
        if (_source0.is_HandOff) {
          return _dafny.Set.fromElements();
        }
      }
      {
        return _dafny.Set.fromElements();
      }
    };
    static ListRefs(s) {
      if ((s).is_ForEach) {
        return _dafny.Set.fromElements((s).dtor_list);
      } else if (((s).is_Ask) && (((s).dtor_form).is_OneOf)) {
        return _dafny.Set.fromElements(((s).dtor_form).dtor_list);
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static Label(i) {
      if ((i).is_Action) {
        return (i).dtor_text;
      } else {
        return (i).dtor_value;
      }
    };
    static Lower(s) {
      return _dafny.Seq.Create(new BigNumber((s).length), ((_0_s) => function (_1_k) {
        return ((((new _dafny.CodePoint('A'.codePointAt(0))).isLessThanOrEqual((_0_s)[_1_k])) && (((_0_s)[_1_k]).isLessThanOrEqual(new _dafny.CodePoint('Z'.codePointAt(0))))) ? (new _dafny.CodePoint(((new BigNumber(((_0_s)[_1_k]).value)).plus(new BigNumber(32))).toNumber())) : ((_0_s)[_1_k]));
      })(s));
    };
    static DataListOk(l) {
      return (((_dafny.ZERO).isLessThan(new BigNumber(((l).dtor_items).length))) && (_dafny.Quantifier(((l).dtor_items).UniqueElements, true, function (_forall_var_0) {
        let _0_i = _forall_var_0;
        return !(_dafny.Seq.contains((l).dtor_items, _0_i)) || (((_0_i).is_Action) === ((((l).dtor_items)[_dafny.ZERO]).is_Action));
      }))) && (_dafny.Quantifier(_dafny.IntegerRange(_dafny.ZERO, new BigNumber(((l).dtor_items).length)), true, function (_forall_var_1) {
        let _1_a = _forall_var_1;
        return _dafny.Quantifier(_dafny.IntegerRange((_1_a).plus(_dafny.ONE), new BigNumber(((l).dtor_items).length)), true, function (_forall_var_2) {
          let _2_b = _forall_var_2;
          return !((((_dafny.ZERO).isLessThanOrEqualTo(_1_a)) && ((_1_a).isLessThan(_2_b))) && ((_2_b).isLessThan(new BigNumber(((l).dtor_items).length)))) || (!_dafny.areEqual(SkopWellFormed.__default.Lower(SkopWellFormed.__default.Label(((l).dtor_items)[_1_a])), SkopWellFormed.__default.Lower(SkopWellFormed.__default.Label(((l).dtor_items)[_2_b]))));
        });
      }));
    };
    static Terminal(s) {
      return (((((((s).is_Then) || ((s).is_Page)) || ((s).is_HandOff)) || ((s).is_Stop)) || (((s).is_Ask) && (((s).dtor_form).is_Sections))) || ((((s).is_Check) && (((s).dtor_onTrue).is_Some)) && (((s).dtor_els).is_ElseTo))) || ((((s).is_ForEach) && ((_dafny.ZERO).isLessThan(new BigNumber(((s).dtor_body).length)))) && (SkopWellFormed.__default.Terminal(((s).dtor_body)[(new BigNumber(((s).dtor_body).length)).minus(_dafny.ONE)])));
    };
    static NoDeadCode(body) {
      return _dafny.Quantifier(_dafny.IntegerRange(_dafny.ZERO, (new BigNumber((body).length)).minus(_dafny.ONE)), true, function (_forall_var_0) {
        let _0_i = _forall_var_0;
        return !(((_dafny.ZERO).isLessThanOrEqualTo(_0_i)) && ((_0_i).isLessThan((new BigNumber((body).length)).minus(_dafny.ONE)))) || (!(SkopWellFormed.__default.Terminal((body)[_0_i])));
      });
    };
    static RubricOk(low, high, rubric) {
      return ((_dafny.Quantifier((rubric).UniqueElements, true, function (_forall_var_0) {
        let _0_r = _forall_var_0;
        return !(_dafny.Seq.contains(rubric, _0_r)) || (((low).isLessThanOrEqualTo((_0_r).dtor_level)) && (((_0_r).dtor_level).isLessThanOrEqualTo(high)));
      })) && (_dafny.Quantifier(_dafny.IntegerRange(_dafny.ZERO, new BigNumber((rubric).length)), true, function (_forall_var_1) {
        let _1_a = _forall_var_1;
        return _dafny.Quantifier(_dafny.IntegerRange((_1_a).plus(_dafny.ONE), new BigNumber((rubric).length)), true, function (_forall_var_2) {
          let _2_b = _forall_var_2;
          return !((((_dafny.ZERO).isLessThanOrEqualTo(_1_a)) && ((_1_a).isLessThan(_2_b))) && ((_2_b).isLessThan(new BigNumber((rubric).length)))) || (!(((rubric)[_1_a]).dtor_level).isEqualTo(((rubric)[_2_b]).dtor_level));
        });
      }))) && (_dafny.Quantifier(_dafny.IntegerRange(low, (high).plus(_dafny.ONE)), true, function (_forall_var_3) {
        let _3_level = _forall_var_3;
        return !(((low).isLessThanOrEqualTo(_3_level)) && ((_3_level).isLessThanOrEqualTo(high))) || ((SkopWellFormed.__default.Levels(rubric)).contains(_3_level));
      }));
    };
    static Levels(rubric) {
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (rubric).Elements) {
          let _0_r = _compr_0;
          if (_dafny.Seq.contains(rubric, _0_r)) {
            _coll0.add((_0_r).dtor_level);
          }
        }
        return _coll0;
      }();
    };
    static AskOk(s) {
      let _source0 = (s).dtor_form;
      {
        if (_source0.is_Sections) {
          let _0_opts = (_source0).options;
          return ((((new BigNumber(2)).isLessThanOrEqualTo(new BigNumber((_0_opts).length))) && ((new BigNumber((_0_opts).length)).isLessThanOrEqualTo(new BigNumber(255)))) && (!(((s).dtor_els).is_Skip))) && (_dafny.Quantifier(_dafny.IntegerRange(_dafny.ZERO, new BigNumber((_0_opts).length)), true, function (_forall_var_0) {
            let _1_a = _forall_var_0;
            return _dafny.Quantifier(_dafny.IntegerRange((_1_a).plus(_dafny.ONE), new BigNumber((_0_opts).length)), true, function (_forall_var_1) {
              let _2_b = _forall_var_1;
              return !((((_dafny.ZERO).isLessThanOrEqualTo(_1_a)) && ((_1_a).isLessThan(_2_b))) && ((_2_b).isLessThan(new BigNumber((_0_opts).length)))) || (!_dafny.areEqual((((_0_opts)[_1_a]).dtor_ref).dtor_id, (((_0_opts)[_2_b]).dtor_ref).dtor_id));
            });
          }));
        }
      }
      {
        if (_source0.is_YesNo) {
          return true;
        }
      }
      {
        if (_source0.is_OneOf) {
          return !(((s).dtor_els).is_Skip);
        }
      }
      {
        let _3_low = (_source0).low;
        let _4_high = (_source0).high;
        let _5_rubric = (_source0).rubric;
        return (((!(((s).dtor_els).is_Skip)) && (((_dafny.ZERO).isLessThanOrEqualTo(_3_low)) && ((_3_low).isLessThan(_4_high)))) && (((_4_high).minus(_3_low)).isLessThan(new BigNumber(10)))) && (SkopWellFormed.__default.RubricOk(_3_low, _4_high, _5_rubric));
      }
    };
    static PartVars(ps) {
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (ps).Elements) {
          let _0_q = _compr_0;
          if ((_dafny.Seq.contains(ps, _0_q)) && ((_0_q).is_Var)) {
            _coll0.add((_0_q).dtor_name);
          }
        }
        return _coll0;
      }();
    };
    static Binding(s) {
      if ((s).is_Run) {
        return (s).dtor_binding;
      } else if (((s).is_Ask) && (((s).dtor_form).is_YesNo)) {
        return SkopAst.Option.create_Some(((s).dtor_form).dtor_binding);
      } else if (((s).is_Ask) && (((s).dtor_form).is_OneOf)) {
        return SkopAst.Option.create_Some(((s).dtor_form).dtor_binding);
      } else if (((s).is_Ask) && (((s).dtor_form).is_Score)) {
        return SkopAst.Option.create_Some(((s).dtor_form).dtor_binding);
      } else {
        return SkopAst.Option.create_None();
      }
    };
    static BindingSet(s) {
      if ((SkopWellFormed.__default.Binding(s)).is_Some) {
        return _dafny.Set.fromElements((SkopWellFormed.__default.Binding(s)).dtor_value);
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static Rebound(p) {
      let _0_stmts = SkopWellFormed.__default.Stmts(p);
      return (function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_0_stmts).Elements) {
          let _1_s = _compr_0;
          if (((_0_stmts).contains(_1_s)) && ((SkopWellFormed.__default.Binding(_1_s)).is_Some)) {
            _coll0.add((SkopWellFormed.__default.Binding(_1_s)).dtor_value);
          }
        }
        return _coll0;
      }()).Union(function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_1 of (_0_stmts).Elements) {
          let _2_s = _compr_1;
          if (((_0_stmts).contains(_2_s)) && ((_2_s).is_ForEach)) {
            _coll1.add((_2_s).dtor_loopVar);
          }
        }
        return _coll1;
      }());
    };
    static AllNames(p) {
      return ((((p).dtor_params).Keys).Union(SkopWellFormed.__default.Builtins)).Union(SkopWellFormed.__default.Rebound(p));
    };
    static TextVars(s) {
      if ((s).is_Ask) {
        return SkopWellFormed.__default.PartVars((s).dtor_question);
      } else if ((s).is_Page) {
        return SkopWellFormed.__default.PartVars((s).dtor_text);
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static Approx(a, b) {
      return (((a).dtor_bound).IsSubsetOf((b).dtor_bound)) && (_dafny.Quantifier(((b).dtor_kinds).Keys.Elements, true, function (_forall_var_0) {
        let _0_x = _forall_var_0;
        return !(((b).dtor_kinds).contains(_0_x)) || ((((a).dtor_kinds).contains(_0_x)) && ((((b).dtor_kinds).get(_0_x)).IsSubsetOf(((a).dtor_kinds).get(_0_x))));
      }));
    };
    static KindsOf(e, x) {
      if (((e).dtor_kinds).contains(x)) {
        return ((e).dtor_kinds).get(x);
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static EntryEnv(p) {
      let _0_names = (((p).dtor_params).Keys).Union(SkopWellFormed.__default.Builtins);
      return SkopWellFormed.Env.create_Env(_0_names, function () {
  let _coll0 = new _dafny.Map();
  for (const _compr_0 of (_0_names).Elements) {
    let _1_x = _compr_0;
    if ((_0_names).contains(_1_x)) {
      _coll0.push([_1_x,(((((p).dtor_params).contains(_1_x)) ? (_dafny.Set.fromElements(SkopWellFormed.Kind.create_KParam())) : (_dafny.Set.fromElements()))).Union((((SkopWellFormed.__default.Builtins).contains(_1_x)) ? (_dafny.Set.fromElements(SkopWellFormed.Kind.create_KBuiltin())) : (_dafny.Set.fromElements())))]);
    }
  }
  return _coll0;
}());
    };
    static BindKinds(s) {
      if ((s).is_Run) {
        return _dafny.Set.fromElements(SkopWellFormed.Kind.create_KRun());
      } else if (((s).is_Ask) && (((s).dtor_form).is_YesNo)) {
        return _dafny.Set.fromElements(SkopWellFormed.Kind.create_KYesNo());
      } else if (((s).is_Ask) && (((s).dtor_form).is_OneOf)) {
        return _dafny.Set.fromElements(SkopWellFormed.Kind.create_KValue((((s).dtor_form).dtor_list).dtor_id));
      } else if (((s).is_Ask) && (((s).dtor_form).is_Score)) {
        return _dafny.Set.fromElements(SkopWellFormed.Kind.create_KScore());
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static ItemKind(i, list) {
      if ((i).is_Action) {
        return SkopWellFormed.Kind.create_KAction(list);
      } else {
        return SkopWellFormed.Kind.create_KValue(list);
      }
    };
    static ItemKinds(p, r) {
      if (SkopWellFormed.__default.IsData(p, (r).dtor_id)) {
        return function () {
          let _coll0 = new _dafny.Set();
          for (const _compr_0 of ((SkopWellFormed.__default.DataList(p, (r).dtor_id)).dtor_items).Elements) {
            let _0_i = _compr_0;
            if (_dafny.Seq.contains((SkopWellFormed.__default.DataList(p, (r).dtor_id)).dtor_items, _0_i)) {
              _coll0.add(SkopWellFormed.__default.ItemKind(_0_i, (r).dtor_id));
            }
          }
          return _coll0;
        }();
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static Forget(e, xs) {
      return SkopWellFormed.Env.create_Env(((e).dtor_bound).Difference(xs), (e).dtor_kinds);
    };
    static After(p, s, e) {
      if ((s).is_ForEach) {
        return SkopWellFormed.__default.LoopExit(p, s, e);
      } else if ((SkopWellFormed.__default.Binding(s)).is_None) {
        return e;
      } else {
        let _0_x = (SkopWellFormed.__default.Binding(s)).dtor_value;
        if (((s).is_Run) && (((s).dtor_els).is_Skip)) {
          return SkopWellFormed.Env.create_Env(((e).dtor_bound).Difference(_dafny.Set.fromElements(_0_x)), ((e).dtor_kinds).update(_0_x, _dafny.Set.fromElements(SkopWellFormed.Kind.create_KRun())));
        } else {
          return SkopWellFormed.Env.create_Env(((e).dtor_bound).Union(_dafny.Set.fromElements(_0_x)), ((e).dtor_kinds).update(_0_x, SkopWellFormed.__default.BindKinds(s)));
        }
      }
    };
    static Walk(p, body, e) {
      if ((new BigNumber((body).length)).isEqualTo(_dafny.ZERO)) {
        return e;
      } else {
        return SkopWellFormed.__default.Walk(p, (body).slice(_dafny.ONE), SkopWellFormed.__default.After(p, (body)[_dafny.ZERO], e));
      }
    };
    static Unbinds(body) {
      let _0_flat = SkopWellFormed.__default.Flat(body);
      return (function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_0_flat).Elements) {
          let _1_s = _compr_0;
          if ((((_dafny.Seq.contains(_0_flat, _1_s)) && ((_1_s).is_Run)) && (((_1_s).dtor_binding).is_Some)) && (((_1_s).dtor_els).is_Skip)) {
            _coll0.add(((_1_s).dtor_binding).dtor_value);
          }
        }
        return _coll0;
      }()).Union(function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_1 of (_0_flat).Elements) {
          let _2_s = _compr_1;
          if ((_dafny.Seq.contains(_0_flat, _2_s)) && ((_2_s).is_ForEach)) {
            _coll1.add((_2_s).dtor_loopVar);
          }
        }
        return _coll1;
      }());
    };
    static BodyKinds(p, body, x) {
      let _0_flat = SkopWellFormed.__default.Flat(body);
      return (function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_0_flat).Elements) {
          let _1_s = _compr_0;
          if ((_dafny.Seq.contains(_0_flat, _1_s)) && (_dafny.areEqual(SkopWellFormed.__default.Binding(_1_s), SkopAst.Option.create_Some(x)))) {
            for (const _compr_1 of (SkopWellFormed.__default.BindKinds(_1_s)).Elements) {
              let _2_k = _compr_1;
              if ((SkopWellFormed.__default.BindKinds(_1_s)).contains(_2_k)) {
                _coll0.add(_2_k);
              }
            }
          }
        }
        return _coll0;
      }()).Union(function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_2 of (_0_flat).Elements) {
          let _3_s = _compr_2;
          if (((_dafny.Seq.contains(_0_flat, _3_s)) && ((_3_s).is_ForEach)) && (_dafny.areEqual((_3_s).dtor_loopVar, x))) {
            for (const _compr_3 of (SkopWellFormed.__default.ItemKinds(p, (_3_s).dtor_list)).Elements) {
              let _4_k = _compr_3;
              if ((SkopWellFormed.__default.ItemKinds(p, (_3_s).dtor_list)).contains(_4_k)) {
                _coll1.add(_4_k);
              }
            }
          }
        }
        return _coll1;
      }());
    };
    static BodyNames(body) {
      let _0_flat = SkopWellFormed.__default.Flat(body);
      return (function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_0_flat).Elements) {
          let _1_s = _compr_0;
          if ((_dafny.Seq.contains(_0_flat, _1_s)) && ((SkopWellFormed.__default.Binding(_1_s)).is_Some)) {
            _coll0.add((SkopWellFormed.__default.Binding(_1_s)).dtor_value);
          }
        }
        return _coll0;
      }()).Union(function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_1 of (_0_flat).Elements) {
          let _2_s = _compr_1;
          if ((_dafny.Seq.contains(_0_flat, _2_s)) && ((_2_s).is_ForEach)) {
            _coll1.add((_2_s).dtor_loopVar);
          }
        }
        return _coll1;
      }());
    };
    static LoopEntry(p, s, e) {
      let _0_names = (((e).dtor_kinds).Keys).Union(SkopWellFormed.__default.BodyNames((s).dtor_body));
      return SkopWellFormed.Env.create_Env((((e).dtor_bound).Difference(SkopWellFormed.__default.Unbinds((s).dtor_body))).Union(_dafny.Set.fromElements((s).dtor_loopVar)), (function () {
  let _coll0 = new _dafny.Map();
  for (const _compr_0 of (_0_names).Elements) {
    let _1_x = _compr_0;
    if ((_0_names).contains(_1_x)) {
      _coll0.push([_1_x,(SkopWellFormed.__default.KindsOf(e, _1_x)).Union(SkopWellFormed.__default.BodyKinds(p, (s).dtor_body, _1_x))]);
    }
  }
  return _coll0;
}()).update((s).dtor_loopVar, SkopWellFormed.__default.ItemKinds(p, (s).dtor_list)));
    };
    static LoopExit(p, s, e) {
      let _0_w = SkopWellFormed.__default.Walk(p, (s).dtor_body, SkopWellFormed.__default.LoopEntry(p, s, e));
      return SkopWellFormed.Env.create_Env(((_0_w).dtor_bound).Difference(_dafny.Set.fromElements((s).dtor_loopVar)), ((_0_w).dtor_kinds).Subtract(_dafny.Set.fromElements((s).dtor_loopVar)));
    };
    static SafeChar(c) {
      return (((((new _dafny.CodePoint('a'.codePointAt(0))).isLessThanOrEqual(c)) && ((c).isLessThanOrEqual(new _dafny.CodePoint('z'.codePointAt(0))))) || (((new _dafny.CodePoint('A'.codePointAt(0))).isLessThanOrEqual(c)) && ((c).isLessThanOrEqual(new _dafny.CodePoint('Z'.codePointAt(0)))))) || (((new _dafny.CodePoint('0'.codePointAt(0))).isLessThanOrEqual(c)) && ((c).isLessThanOrEqual(new _dafny.CodePoint('9'.codePointAt(0)))))) || (_dafny.Seq.contains(_dafny.Seq.UnicodeFromString("._/:@%+=,-"), c));
    };
    static SafeValue(v) {
      return (((_dafny.ZERO).isLessThan(new BigNumber((v).length))) && (!_dafny.areEqual((v)[_dafny.ZERO], new _dafny.CodePoint('-'.codePointAt(0))))) && (_dafny.Quantifier((v).UniqueElements, true, function (_forall_var_0) {
        let _0_c = _forall_var_0;
        return !(_dafny.Seq.contains(v, _0_c)) || (SkopWellFormed.__default.SafeChar(_0_c));
      }));
    };
    static SafeParam(v) {
      if ((v).is_PStr) {
        return SkopWellFormed.__default.SafeValue((v).dtor_s);
      } else {
        return (_dafny.ZERO).isLessThanOrEqualTo((v).dtor_i);
      }
    };
    static ValuesSafe(p, id) {
      return !(SkopWellFormed.__default.IsData(p, id)) || (_dafny.Quantifier(((SkopWellFormed.__default.DataList(p, id)).dtor_items).UniqueElements, true, function (_forall_var_0) {
        let _0_i = _forall_var_0;
        return !((_dafny.Seq.contains((SkopWellFormed.__default.DataList(p, id)).dtor_items, _0_i)) && ((_0_i).is_Value)) || (SkopWellFormed.__default.SafeValue((_0_i).dtor_value));
      }));
    };
    static CmdKindOk(p, x, k) {
      return (((!((k).is_KRun)) && (!((k).is_KAction))) && (!(_dafny.areEqual(k, SkopWellFormed.Kind.create_KParam())) || ((((p).dtor_params).contains(x)) && (SkopWellFormed.__default.SafeParam(((p).dtor_params).get(x)))))) && (!((k).is_KValue) || (SkopWellFormed.__default.ValuesSafe(p, (k).dtor_list)));
    };
    static CmdVarOk(p, e, x) {
      return (((e).dtor_bound).contains(x)) && (_dafny.Quantifier((SkopWellFormed.__default.KindsOf(e, x)).Elements, true, function (_forall_var_0) {
        let _0_k = _forall_var_0;
        return !((SkopWellFormed.__default.KindsOf(e, x)).contains(_0_k)) || (SkopWellFormed.__default.CmdKindOk(p, x, _0_k));
      }));
    };
    static ActionVars(p, list) {
      if (SkopWellFormed.__default.IsData(p, list)) {
        return function () {
          let _coll0 = new _dafny.Set();
          for (const _compr_0 of ((SkopWellFormed.__default.DataList(p, list)).dtor_items).Elements) {
            let _0_i = _compr_0;
            if ((_dafny.Seq.contains((SkopWellFormed.__default.DataList(p, list)).dtor_items, _0_i)) && ((_0_i).is_Action)) {
              for (const _compr_1 of (SkopWellFormed.__default.PartVars((_0_i).dtor_cmd)).Elements) {
                let _1_y = _compr_1;
                if ((SkopWellFormed.__default.PartVars((_0_i).dtor_cmd)).contains(_1_y)) {
                  _coll0.add(_1_y);
                }
              }
            }
          }
          return _coll0;
        }();
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static CmdVars(s) {
      let _source0 = s;
      {
        if (_source0.is_Run) {
          let _0_cmd = (_source0).cmd;
          return SkopWellFormed.__default.PartVars(_0_cmd);
        }
      }
      {
        if (_source0.is_Do) {
          let action0 = (_source0).action;
          if (action0.is_DoCmd) {
            let _1_cmd = (action0).cmd;
            return SkopWellFormed.__default.PartVars(_1_cmd);
          }
        }
      }
      {
        if (_source0.is_Check) {
          let cond0 = (_source0).cond;
          if (cond0.is_Succeeds) {
            let _2_cmd = (cond0).cmd;
            return SkopWellFormed.__default.PartVars(_2_cmd);
          }
        }
      }
      {
        if (_source0.is_IfYesRun) {
          let _3_cmd = (_source0).cmd;
          return SkopWellFormed.__default.PartVars(_3_cmd);
        }
      }
      {
        if (_source0.is_IfYesDo) {
          let action1 = (_source0).action;
          if (action1.is_DoCmd) {
            let _4_cmd = (action1).cmd;
            return SkopWellFormed.__default.PartVars(_4_cmd);
          }
        }
      }
      {
        return _dafny.Set.fromElements();
      }
    };
    static OperandVars(s) {
      if (((s).is_Check) && (((s).dtor_cond).is_Cmp)) {
        return ((((((s).dtor_cond).dtor_l).is_VarOp) ? (_dafny.Set.fromElements((((s).dtor_cond).dtor_l).dtor_name)) : (_dafny.Set.fromElements()))).Union((((((s).dtor_cond).dtor_r).is_VarOp) ? (_dafny.Set.fromElements((((s).dtor_cond).dtor_r).dtor_name)) : (_dafny.Set.fromElements())));
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static DoItems(s) {
      if ((((s).is_Do) || ((s).is_IfYesDo)) && (((s).dtor_action).is_DoItem)) {
        return _dafny.Set.fromElements(((s).dtor_action).dtor_item);
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static MayBind(s, x) {
      return ((SkopWellFormed.__default.BindingSet(s)).contains(x)) || (((s).is_ForEach) && ((_dafny.areEqual(x, (s).dtor_loopVar)) || ((SkopWellFormed.__default.BodyNames((s).dtor_body)).contains(x))));
    };
    static NextGov(s, gov) {
      if (((s).is_Ask) && (((s).dtor_form).is_YesNo)) {
        return SkopAst.Option.create_Some(((s).dtor_form).dtor_binding);
      } else if (((gov).is_Some) && (SkopWellFormed.__default.MayBind(s, (gov).dtor_value))) {
        return SkopAst.Option.create_None();
      } else {
        return gov;
      }
    };
    static Holds(a, c) {
      return (((a).dtor_bound).IsSubsetOf((c).Keys)) && (_dafny.Quantifier((c).Keys.Elements, true, function (_forall_var_0) {
        let _0_x = _forall_var_0;
        return !((c).contains(_0_x)) || ((((a).dtor_kinds).contains(_0_x)) && ((((a).dtor_kinds).get(_0_x)).contains((c).get(_0_x))));
      }));
    };
    static Initial(p) {
      return function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of ((((p).dtor_params).Keys).Union(SkopWellFormed.__default.Builtins)).Elements) {
          let _0_x = _compr_0;
          if (((((p).dtor_params).Keys).Union(SkopWellFormed.__default.Builtins)).contains(_0_x)) {
            _coll0.push([_0_x,((((p).dtor_params).contains(_0_x)) ? (SkopWellFormed.Kind.create_KParam()) : (SkopWellFormed.Kind.create_KBuiltin()))]);
          }
        }
        return _coll0;
      }();
    };
    static TransferEnv(s, c, lv, c_k) {
      return ((((((c).Keys).Difference(lv)).Difference(SkopWellFormed.__default.BindingSet(s))).IsSubsetOf((c_k).Keys)) && (((c_k).Keys).IsSubsetOf(((c).Keys).Difference(lv)))) && (_dafny.Quantifier((c_k).Keys.Elements, true, function (_forall_var_0) {
        let _0_x = _forall_var_0;
        return !((c_k).contains(_0_x)) || (_dafny.areEqual((c_k).get(_0_x), (c).get(_0_x)));
      }));
    };
    static get Builtins() {
      return _dafny.Set.fromElements(_dafny.Seq.UnicodeFromString("host"), _dafny.Seq.UnicodeFromString("run_id"), _dafny.Seq.UnicodeFromString("skill"));
    };
  };

  $module.Jump = class Jump {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Jump(ref, src) {
      let $dt = new Jump(0);
      $dt.ref = ref;
      $dt.src = src;
      return $dt;
    }
    get is_Jump() { return this.$tag === 0; }
    get dtor_ref() { return this.ref; }
    get dtor_src() { return this.src; }
    toString() {
      if (this.$tag === 0) {
        return "SkopWellFormed.Jump.Jump" + "(" + _dafny.toString(this.ref) + ", " + _dafny.toString(this.src) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.ref, other.ref) && _dafny.areEqual(this.src, other.src);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopWellFormed.Jump.create_Jump(SkopAst.SectionRef.Default(), _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Jump.Default();
        }
      };
    }
  }

  $module.Kind = class Kind {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_KParam() {
      let $dt = new Kind(0);
      return $dt;
    }
    static create_KBuiltin() {
      let $dt = new Kind(1);
      return $dt;
    }
    static create_KRun() {
      let $dt = new Kind(2);
      return $dt;
    }
    static create_KValue(list) {
      let $dt = new Kind(3);
      $dt.list = list;
      return $dt;
    }
    static create_KAction(list) {
      let $dt = new Kind(4);
      $dt.list = list;
      return $dt;
    }
    static create_KYesNo() {
      let $dt = new Kind(5);
      return $dt;
    }
    static create_KScore() {
      let $dt = new Kind(6);
      return $dt;
    }
    get is_KParam() { return this.$tag === 0; }
    get is_KBuiltin() { return this.$tag === 1; }
    get is_KRun() { return this.$tag === 2; }
    get is_KValue() { return this.$tag === 3; }
    get is_KAction() { return this.$tag === 4; }
    get is_KYesNo() { return this.$tag === 5; }
    get is_KScore() { return this.$tag === 6; }
    get dtor_list() { return this.list; }
    toString() {
      if (this.$tag === 0) {
        return "SkopWellFormed.Kind.KParam";
      } else if (this.$tag === 1) {
        return "SkopWellFormed.Kind.KBuiltin";
      } else if (this.$tag === 2) {
        return "SkopWellFormed.Kind.KRun";
      } else if (this.$tag === 3) {
        return "SkopWellFormed.Kind.KValue" + "(" + this.list.toVerbatimString(true) + ")";
      } else if (this.$tag === 4) {
        return "SkopWellFormed.Kind.KAction" + "(" + this.list.toVerbatimString(true) + ")";
      } else if (this.$tag === 5) {
        return "SkopWellFormed.Kind.KYesNo";
      } else if (this.$tag === 6) {
        return "SkopWellFormed.Kind.KScore";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else if (this.$tag === 2) {
        return other.$tag === 2;
      } else if (this.$tag === 3) {
        return other.$tag === 3 && _dafny.areEqual(this.list, other.list);
      } else if (this.$tag === 4) {
        return other.$tag === 4 && _dafny.areEqual(this.list, other.list);
      } else if (this.$tag === 5) {
        return other.$tag === 5;
      } else if (this.$tag === 6) {
        return other.$tag === 6;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopWellFormed.Kind.create_KParam();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Kind.Default();
        }
      };
    }
  }

  $module.Env = class Env {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Env(bound, kinds) {
      let $dt = new Env(0);
      $dt.bound = bound;
      $dt.kinds = kinds;
      return $dt;
    }
    get is_Env() { return this.$tag === 0; }
    get dtor_bound() { return this.bound; }
    get dtor_kinds() { return this.kinds; }
    toString() {
      if (this.$tag === 0) {
        return "SkopWellFormed.Env.Env" + "(" + _dafny.toString(this.bound) + ", " + _dafny.toString(this.kinds) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.bound, other.bound) && _dafny.areEqual(this.kinds, other.kinds);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopWellFormed.Env.create_Env(_dafny.Set.Empty, _dafny.Map.Empty);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Env.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module SkopWellFormed
let SkopStep = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "SkopStep._default";
    }
    _parentTraits() {
      return [];
    }
    static Answers(n, r) {
      return ((r).is_DeadlineExceeded) || (function () {
        let _source0 = n;
        {
          if (_source0.is_Exec) {
            return (r).is_ExecResult;
          }
        }
        {
          if (_source0.is_AskNext) {
            return ((r).is_AskAnswer) || ((r).is_AskFailed);
          }
        }
        {
          if (_source0.is_PageNext) {
            return (r).is_PageResult;
          }
        }
        {
          if (_source0.is_Choose) {
            let _0_k = (_source0).n;
            return ((r).is_Picked) && (((r).dtor_i).isLessThan(_0_k));
          }
        }
        {
          return false;
        }
      }());
    };
  };

  $module.Origin = class Origin {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_FromParam() {
      let $dt = new Origin(0);
      return $dt;
    }
    static create_FromBuiltin() {
      let $dt = new Origin(1);
      return $dt;
    }
    static create_FromListItem() {
      let $dt = new Origin(2);
      return $dt;
    }
    static create_FromYesNo() {
      let $dt = new Origin(3);
      return $dt;
    }
    static create_FromScore() {
      let $dt = new Origin(4);
      return $dt;
    }
    static create_FromRunOutput() {
      let $dt = new Origin(5);
      return $dt;
    }
    get is_FromParam() { return this.$tag === 0; }
    get is_FromBuiltin() { return this.$tag === 1; }
    get is_FromListItem() { return this.$tag === 2; }
    get is_FromYesNo() { return this.$tag === 3; }
    get is_FromScore() { return this.$tag === 4; }
    get is_FromRunOutput() { return this.$tag === 5; }
    static get AllSingletonConstructors() {
      return this.AllSingletonConstructors_();
    }
    static *AllSingletonConstructors_() {
      yield Origin.create_FromParam();
      yield Origin.create_FromBuiltin();
      yield Origin.create_FromListItem();
      yield Origin.create_FromYesNo();
      yield Origin.create_FromScore();
      yield Origin.create_FromRunOutput();
    }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Origin.FromParam";
      } else if (this.$tag === 1) {
        return "SkopStep.Origin.FromBuiltin";
      } else if (this.$tag === 2) {
        return "SkopStep.Origin.FromListItem";
      } else if (this.$tag === 3) {
        return "SkopStep.Origin.FromYesNo";
      } else if (this.$tag === 4) {
        return "SkopStep.Origin.FromScore";
      } else if (this.$tag === 5) {
        return "SkopStep.Origin.FromRunOutput";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else if (this.$tag === 2) {
        return other.$tag === 2;
      } else if (this.$tag === 3) {
        return other.$tag === 3;
      } else if (this.$tag === 4) {
        return other.$tag === 4;
      } else if (this.$tag === 5) {
        return other.$tag === 5;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Origin.create_FromParam();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Origin.Default();
        }
      };
    }
  }

  $module.Val = class Val {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Str(s) {
      let $dt = new Val(0);
      $dt.s = s;
      return $dt;
    }
    static create_Int(i) {
      let $dt = new Val(1);
      $dt.i = i;
      return $dt;
    }
    get is_Str() { return this.$tag === 0; }
    get is_Int() { return this.$tag === 1; }
    get dtor_s() { return this.s; }
    get dtor_i() { return this.i; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Val.Str" + "(" + this.s.toVerbatimString(true) + ")";
      } else if (this.$tag === 1) {
        return "SkopStep.Val.Int" + "(" + _dafny.toString(this.i) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.s, other.s);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.i, other.i);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Val.create_Str(_dafny.Seq.UnicodeFromString(""));
    }
    static Rtd() {
      return class {
        static get Default() {
          return Val.Default();
        }
      };
    }
  }

  $module.Bound = class Bound {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Bound(value, origin) {
      let $dt = new Bound(0);
      $dt.value = value;
      $dt.origin = origin;
      return $dt;
    }
    get is_Bound() { return this.$tag === 0; }
    get dtor_value() { return this.value; }
    get dtor_origin() { return this.origin; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Bound.Bound" + "(" + _dafny.toString(this.value) + ", " + _dafny.toString(this.origin) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.value, other.value) && _dafny.areEqual(this.origin, other.origin);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Bound.create_Bound(SkopStep.Val.Default(), SkopStep.Origin.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Bound.Default();
        }
      };
    }
  }

  $module.Piece = class Piece {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_AuthorLit(s) {
      let $dt = new Piece(0);
      $dt.s = s;
      return $dt;
    }
    static create_Trusted(s, origin) {
      let $dt = new Piece(1);
      $dt.s = s;
      $dt.origin = origin;
      return $dt;
    }
    get is_AuthorLit() { return this.$tag === 0; }
    get is_Trusted() { return this.$tag === 1; }
    get dtor_s() { return this.s; }
    get dtor_origin() { return this.origin; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Piece.AuthorLit" + "(" + this.s.toVerbatimString(true) + ")";
      } else if (this.$tag === 1) {
        return "SkopStep.Piece.Trusted" + "(" + this.s.toVerbatimString(true) + ", " + _dafny.toString(this.origin) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.s, other.s);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.s, other.s) && _dafny.areEqual(this.origin, other.origin);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Piece.create_AuthorLit(_dafny.Seq.UnicodeFromString(""));
    }
    static Rtd() {
      return class {
        static get Default() {
          return Piece.Default();
        }
      };
    }
  }

  $module.ExecKind = class ExecKind {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_RunExec() {
      let $dt = new ExecKind(0);
      return $dt;
    }
    static create_DoExec() {
      let $dt = new ExecKind(1);
      return $dt;
    }
    static create_CheckExec() {
      let $dt = new ExecKind(2);
      return $dt;
    }
    get is_RunExec() { return this.$tag === 0; }
    get is_DoExec() { return this.$tag === 1; }
    get is_CheckExec() { return this.$tag === 2; }
    static get AllSingletonConstructors() {
      return this.AllSingletonConstructors_();
    }
    static *AllSingletonConstructors_() {
      yield ExecKind.create_RunExec();
      yield ExecKind.create_DoExec();
      yield ExecKind.create_CheckExec();
    }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.ExecKind.RunExec";
      } else if (this.$tag === 1) {
        return "SkopStep.ExecKind.DoExec";
      } else if (this.$tag === 2) {
        return "SkopStep.ExecKind.CheckExec";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else if (this.$tag === 2) {
        return other.$tag === 2;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.ExecKind.create_RunExec();
    }
    static Rtd() {
      return class {
        static get Default() {
          return ExecKind.Default();
        }
      };
    }
  }

  $module.AskKind = class AskKind {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Choice() {
      let $dt = new AskKind(0);
      return $dt;
    }
    static create_YesNoKind() {
      let $dt = new AskKind(1);
      return $dt;
    }
    static create_ScoreKind() {
      let $dt = new AskKind(2);
      return $dt;
    }
    get is_Choice() { return this.$tag === 0; }
    get is_YesNoKind() { return this.$tag === 1; }
    get is_ScoreKind() { return this.$tag === 2; }
    static get AllSingletonConstructors() {
      return this.AllSingletonConstructors_();
    }
    static *AllSingletonConstructors_() {
      yield AskKind.create_Choice();
      yield AskKind.create_YesNoKind();
      yield AskKind.create_ScoreKind();
    }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.AskKind.Choice";
      } else if (this.$tag === 1) {
        return "SkopStep.AskKind.YesNoKind";
      } else if (this.$tag === 2) {
        return "SkopStep.AskKind.ScoreKind";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else if (this.$tag === 2) {
        return other.$tag === 2;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.AskKind.create_Choice();
    }
    static Rtd() {
      return class {
        static get Default() {
          return AskKind.Default();
        }
      };
    }
  }

  $module.AskOpt = class AskOpt {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_AskOpt(id, text, description) {
      let $dt = new AskOpt(0);
      $dt.id = id;
      $dt.text = text;
      $dt.description = description;
      return $dt;
    }
    get is_AskOpt() { return this.$tag === 0; }
    get dtor_id() { return this.id; }
    get dtor_text() { return this.text; }
    get dtor_description() { return this.description; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.AskOpt.AskOpt" + "(" + this.id.toVerbatimString(true) + ", " + this.text.toVerbatimString(true) + ", " + _dafny.toString(this.description) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.id, other.id) && _dafny.areEqual(this.text, other.text) && _dafny.areEqual(this.description, other.description);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.AskOpt.create_AskOpt(_dafny.Seq.UnicodeFromString(""), _dafny.Seq.UnicodeFromString(""), SkopAst.Option.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return AskOpt.Default();
        }
      };
    }
  }

  $module.AskRequest = class AskRequest {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_AskRequest(kind, question, guidance, options, context, timeoutMs) {
      let $dt = new AskRequest(0);
      $dt.kind = kind;
      $dt.question = question;
      $dt.guidance = guidance;
      $dt.options = options;
      $dt.context = context;
      $dt.timeoutMs = timeoutMs;
      return $dt;
    }
    get is_AskRequest() { return this.$tag === 0; }
    get dtor_kind() { return this.kind; }
    get dtor_question() { return this.question; }
    get dtor_guidance() { return this.guidance; }
    get dtor_options() { return this.options; }
    get dtor_context() { return this.context; }
    get dtor_timeoutMs() { return this.timeoutMs; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.AskRequest.AskRequest" + "(" + _dafny.toString(this.kind) + ", " + this.question.toVerbatimString(true) + ", " + _dafny.toString(this.guidance) + ", " + _dafny.toString(this.options) + ", " + _dafny.toString(this.context) + ", " + _dafny.toString(this.timeoutMs) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.kind, other.kind) && _dafny.areEqual(this.question, other.question) && _dafny.areEqual(this.guidance, other.guidance) && _dafny.areEqual(this.options, other.options) && _dafny.areEqual(this.context, other.context) && _dafny.areEqual(this.timeoutMs, other.timeoutMs);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.AskRequest.create_AskRequest(SkopStep.AskKind.Default(), _dafny.Seq.UnicodeFromString(""), SkopAst.Option.Default(), _dafny.Seq.of(), _dafny.Map.Empty, _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return AskRequest.Default();
        }
      };
    }
  }

  $module.Reason = class Reason {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Explicit() {
      let $dt = new Reason(0);
      return $dt;
    }
    static create_GateFailed() {
      let $dt = new Reason(1);
      return $dt;
    }
    static create_CommandFailed() {
      let $dt = new Reason(2);
      return $dt;
    }
    static create_AskUnavailable() {
      let $dt = new Reason(3);
      return $dt;
    }
    static create_Deadline() {
      let $dt = new Reason(4);
      return $dt;
    }
    get is_Explicit() { return this.$tag === 0; }
    get is_GateFailed() { return this.$tag === 1; }
    get is_CommandFailed() { return this.$tag === 2; }
    get is_AskUnavailable() { return this.$tag === 3; }
    get is_Deadline() { return this.$tag === 4; }
    static get AllSingletonConstructors() {
      return this.AllSingletonConstructors_();
    }
    static *AllSingletonConstructors_() {
      yield Reason.create_Explicit();
      yield Reason.create_GateFailed();
      yield Reason.create_CommandFailed();
      yield Reason.create_AskUnavailable();
      yield Reason.create_Deadline();
    }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Reason.Explicit";
      } else if (this.$tag === 1) {
        return "SkopStep.Reason.GateFailed";
      } else if (this.$tag === 2) {
        return "SkopStep.Reason.CommandFailed";
      } else if (this.$tag === 3) {
        return "SkopStep.Reason.AskUnavailable";
      } else if (this.$tag === 4) {
        return "SkopStep.Reason.Deadline";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else if (this.$tag === 2) {
        return other.$tag === 2;
      } else if (this.$tag === 3) {
        return other.$tag === 3;
      } else if (this.$tag === 4) {
        return other.$tag === 4;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Reason.create_Explicit();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Reason.Default();
        }
      };
    }
  }

  $module.Outcome = class Outcome {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Stopped() {
      let $dt = new Outcome(0);
      return $dt;
    }
    static create_Paged() {
      let $dt = new Outcome(1);
      return $dt;
    }
    static create_Handoff(reason, detail) {
      let $dt = new Outcome(2);
      $dt.reason = reason;
      $dt.detail = detail;
      return $dt;
    }
    get is_Stopped() { return this.$tag === 0; }
    get is_Paged() { return this.$tag === 1; }
    get is_Handoff() { return this.$tag === 2; }
    get dtor_reason() { return this.reason; }
    get dtor_detail() { return this.detail; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Outcome.Stopped";
      } else if (this.$tag === 1) {
        return "SkopStep.Outcome.Paged";
      } else if (this.$tag === 2) {
        return "SkopStep.Outcome.Handoff" + "(" + _dafny.toString(this.reason) + ", " + _dafny.toString(this.detail) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.reason, other.reason) && _dafny.areEqual(this.detail, other.detail);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Outcome.create_Stopped();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Outcome.Default();
        }
      };
    }
  }

  $module.Next = class Next {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Exec(cmd, kind, timeoutMs, src) {
      let $dt = new Next(0);
      $dt.cmd = cmd;
      $dt.kind = kind;
      $dt.timeoutMs = timeoutMs;
      $dt.src = src;
      return $dt;
    }
    static create_AskNext(request, src) {
      let $dt = new Next(1);
      $dt.request = request;
      $dt.src = src;
      return $dt;
    }
    static create_PageNext(text, src) {
      let $dt = new Next(2);
      $dt.text = text;
      $dt.src = src;
      return $dt;
    }
    static create_Choose(n) {
      let $dt = new Next(3);
      $dt.n = n;
      return $dt;
    }
    static create_Done(outcome) {
      let $dt = new Next(4);
      $dt.outcome = outcome;
      return $dt;
    }
    get is_Exec() { return this.$tag === 0; }
    get is_AskNext() { return this.$tag === 1; }
    get is_PageNext() { return this.$tag === 2; }
    get is_Choose() { return this.$tag === 3; }
    get is_Done() { return this.$tag === 4; }
    get dtor_cmd() { return this.cmd; }
    get dtor_kind() { return this.kind; }
    get dtor_timeoutMs() { return this.timeoutMs; }
    get dtor_src() { return this.src; }
    get dtor_request() { return this.request; }
    get dtor_text() { return this.text; }
    get dtor_n() { return this.n; }
    get dtor_outcome() { return this.outcome; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Next.Exec" + "(" + this.cmd.toVerbatimString(true) + ", " + _dafny.toString(this.kind) + ", " + _dafny.toString(this.timeoutMs) + ", " + _dafny.toString(this.src) + ")";
      } else if (this.$tag === 1) {
        return "SkopStep.Next.AskNext" + "(" + _dafny.toString(this.request) + ", " + _dafny.toString(this.src) + ")";
      } else if (this.$tag === 2) {
        return "SkopStep.Next.PageNext" + "(" + this.text.toVerbatimString(true) + ", " + _dafny.toString(this.src) + ")";
      } else if (this.$tag === 3) {
        return "SkopStep.Next.Choose" + "(" + _dafny.toString(this.n) + ")";
      } else if (this.$tag === 4) {
        return "SkopStep.Next.Done" + "(" + _dafny.toString(this.outcome) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.cmd, other.cmd) && _dafny.areEqual(this.kind, other.kind) && _dafny.areEqual(this.timeoutMs, other.timeoutMs) && _dafny.areEqual(this.src, other.src);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.request, other.request) && _dafny.areEqual(this.src, other.src);
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.text, other.text) && _dafny.areEqual(this.src, other.src);
      } else if (this.$tag === 3) {
        return other.$tag === 3 && _dafny.areEqual(this.n, other.n);
      } else if (this.$tag === 4) {
        return other.$tag === 4 && _dafny.areEqual(this.outcome, other.outcome);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Next.create_Exec(_dafny.Seq.UnicodeFromString(""), SkopStep.ExecKind.Default(), _dafny.ZERO, _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Next.Default();
        }
      };
    }
  }

  $module.AskFailure = class AskFailure {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Unavailable() {
      let $dt = new AskFailure(0);
      return $dt;
    }
    static create_RequestTooLarge() {
      let $dt = new AskFailure(1);
      return $dt;
    }
    get is_Unavailable() { return this.$tag === 0; }
    get is_RequestTooLarge() { return this.$tag === 1; }
    static get AllSingletonConstructors() {
      return this.AllSingletonConstructors_();
    }
    static *AllSingletonConstructors_() {
      yield AskFailure.create_Unavailable();
      yield AskFailure.create_RequestTooLarge();
    }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.AskFailure.Unavailable";
      } else if (this.$tag === 1) {
        return "SkopStep.AskFailure.RequestTooLarge";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.AskFailure.create_Unavailable();
    }
    static Rtd() {
      return class {
        static get Default() {
          return AskFailure.Default();
        }
      };
    }
  }

  $module.Response = class Response {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_NoResponse() {
      let $dt = new Response(0);
      return $dt;
    }
    static create_ExecResult(exit, stdout, stderrTail, timedOut) {
      let $dt = new Response(1);
      $dt.exit = exit;
      $dt.stdout = stdout;
      $dt.stderrTail = stderrTail;
      $dt.timedOut = timedOut;
      return $dt;
    }
    static create_AskAnswer(probs, unassigned, backend, model, ms) {
      let $dt = new Response(2);
      $dt.probs = probs;
      $dt.unassigned = unassigned;
      $dt.backend = backend;
      $dt.model = model;
      $dt.ms = ms;
      return $dt;
    }
    static create_AskFailed(error, backend) {
      let $dt = new Response(3);
      $dt.error = error;
      $dt.backend = backend;
      return $dt;
    }
    static create_PageResult(ok) {
      let $dt = new Response(4);
      $dt.ok = ok;
      return $dt;
    }
    static create_Picked(i) {
      let $dt = new Response(5);
      $dt.i = i;
      return $dt;
    }
    static create_DeadlineExceeded() {
      let $dt = new Response(6);
      return $dt;
    }
    get is_NoResponse() { return this.$tag === 0; }
    get is_ExecResult() { return this.$tag === 1; }
    get is_AskAnswer() { return this.$tag === 2; }
    get is_AskFailed() { return this.$tag === 3; }
    get is_PageResult() { return this.$tag === 4; }
    get is_Picked() { return this.$tag === 5; }
    get is_DeadlineExceeded() { return this.$tag === 6; }
    get dtor_exit() { return this.exit; }
    get dtor_stdout() { return this.stdout; }
    get dtor_stderrTail() { return this.stderrTail; }
    get dtor_timedOut() { return this.timedOut; }
    get dtor_probs() { return this.probs; }
    get dtor_unassigned() { return this.unassigned; }
    get dtor_backend() { return this.backend; }
    get dtor_model() { return this.model; }
    get dtor_ms() { return this.ms; }
    get dtor_error() { return this.error; }
    get dtor_ok() { return this.ok; }
    get dtor_i() { return this.i; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Response.NoResponse";
      } else if (this.$tag === 1) {
        return "SkopStep.Response.ExecResult" + "(" + _dafny.toString(this.exit) + ", " + this.stdout.toVerbatimString(true) + ", " + this.stderrTail.toVerbatimString(true) + ", " + _dafny.toString(this.timedOut) + ")";
      } else if (this.$tag === 2) {
        return "SkopStep.Response.AskAnswer" + "(" + _dafny.toString(this.probs) + ", " + _dafny.toString(this.unassigned) + ", " + this.backend.toVerbatimString(true) + ", " + this.model.toVerbatimString(true) + ", " + _dafny.toString(this.ms) + ")";
      } else if (this.$tag === 3) {
        return "SkopStep.Response.AskFailed" + "(" + _dafny.toString(this.error) + ", " + this.backend.toVerbatimString(true) + ")";
      } else if (this.$tag === 4) {
        return "SkopStep.Response.PageResult" + "(" + _dafny.toString(this.ok) + ")";
      } else if (this.$tag === 5) {
        return "SkopStep.Response.Picked" + "(" + _dafny.toString(this.i) + ")";
      } else if (this.$tag === 6) {
        return "SkopStep.Response.DeadlineExceeded";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.exit, other.exit) && _dafny.areEqual(this.stdout, other.stdout) && _dafny.areEqual(this.stderrTail, other.stderrTail) && this.timedOut === other.timedOut;
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.probs, other.probs) && _dafny.areEqual(this.unassigned, other.unassigned) && _dafny.areEqual(this.backend, other.backend) && _dafny.areEqual(this.model, other.model) && _dafny.areEqual(this.ms, other.ms);
      } else if (this.$tag === 3) {
        return other.$tag === 3 && _dafny.areEqual(this.error, other.error) && _dafny.areEqual(this.backend, other.backend);
      } else if (this.$tag === 4) {
        return other.$tag === 4 && this.ok === other.ok;
      } else if (this.$tag === 5) {
        return other.$tag === 5 && _dafny.areEqual(this.i, other.i);
      } else if (this.$tag === 6) {
        return other.$tag === 6;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Response.create_NoResponse();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Response.Default();
        }
      };
    }
  }

  $module.Where = class Where {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Where(section, line) {
      let $dt = new Where(0);
      $dt.section = section;
      $dt.line = line;
      return $dt;
    }
    get is_Where() { return this.$tag === 0; }
    get dtor_section() { return this.section; }
    get dtor_line() { return this.line; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Where.Where" + "(" + this.section.toVerbatimString(true) + ", " + _dafny.toString(this.line) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.section, other.section) && _dafny.areEqual(this.line, other.line);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Where.create_Where(_dafny.Seq.UnicodeFromString(""), _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Where.Default();
        }
      };
    }
  }

  $module.Chosen = class Chosen {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_ChosenId(id) {
      let $dt = new Chosen(0);
      $dt.id = id;
      return $dt;
    }
    static create_ChosenLevel(level) {
      let $dt = new Chosen(1);
      $dt.level = level;
      return $dt;
    }
    get is_ChosenId() { return this.$tag === 0; }
    get is_ChosenLevel() { return this.$tag === 1; }
    get dtor_id() { return this.id; }
    get dtor_level() { return this.level; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Chosen.ChosenId" + "(" + this.id.toVerbatimString(true) + ")";
      } else if (this.$tag === 1) {
        return "SkopStep.Chosen.ChosenLevel" + "(" + _dafny.toString(this.level) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.id, other.id);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.level, other.level);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Chosen.create_ChosenId(_dafny.Seq.UnicodeFromString(""));
    }
    static Rtd() {
      return class {
        static get Default() {
          return Chosen.Default();
        }
      };
    }
  }

  $module.EventBody = class EventBody {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_RunEv(cmd, exit, timedOut, afterWouldDo) {
      let $dt = new EventBody(0);
      $dt.cmd = cmd;
      $dt.exit = exit;
      $dt.timedOut = timedOut;
      $dt.afterWouldDo = afterWouldDo;
      return $dt;
    }
    static create_CheckCmdEv(cmd, exit, timedOut, afterWouldDo) {
      let $dt = new EventBody(1);
      $dt.cmd = cmd;
      $dt.exit = exit;
      $dt.timedOut = timedOut;
      $dt.afterWouldDo = afterWouldDo;
      return $dt;
    }
    static create_CheckEv(expr, left, right, result, afterWouldDo) {
      let $dt = new EventBody(2);
      $dt.expr = expr;
      $dt.left = left;
      $dt.right = right;
      $dt.result = result;
      $dt.afterWouldDo = afterWouldDo;
      return $dt;
    }
    static create_AskEv(question, kind, probs, chosen, confidence, sure, passed, range, detail, afterWouldDo) {
      let $dt = new EventBody(3);
      $dt.question = question;
      $dt.kind = kind;
      $dt.probs = probs;
      $dt.chosen = chosen;
      $dt.confidence = confidence;
      $dt.sure = sure;
      $dt.passed = passed;
      $dt.range = range;
      $dt.detail = detail;
      $dt.afterWouldDo = afterWouldDo;
      return $dt;
    }
    static create_EffectStartEv(cmd) {
      let $dt = new EventBody(4);
      $dt.cmd = cmd;
      return $dt;
    }
    static create_EffectEndEv(cmd, exit, timedOut) {
      let $dt = new EventBody(5);
      $dt.cmd = cmd;
      $dt.exit = exit;
      $dt.timedOut = timedOut;
      return $dt;
    }
    static create_WouldDoEv(cmd) {
      let $dt = new EventBody(6);
      $dt.cmd = cmd;
      return $dt;
    }
    static create_PageEv(text, ok) {
      let $dt = new EventBody(7);
      $dt.text = text;
      $dt.ok = ok;
      return $dt;
    }
    static create_WouldPageEv(text) {
      let $dt = new EventBody(8);
      $dt.text = text;
      return $dt;
    }
    static create_TransferEv(from, to) {
      let $dt = new EventBody(9);
      $dt.from = from;
      $dt.to = to;
      return $dt;
    }
    static create_OutcomeEv(outcome, askCalls, effects, dry) {
      let $dt = new EventBody(10);
      $dt.outcome = outcome;
      $dt.askCalls = askCalls;
      $dt.effects = effects;
      $dt.dry = dry;
      return $dt;
    }
    get is_RunEv() { return this.$tag === 0; }
    get is_CheckCmdEv() { return this.$tag === 1; }
    get is_CheckEv() { return this.$tag === 2; }
    get is_AskEv() { return this.$tag === 3; }
    get is_EffectStartEv() { return this.$tag === 4; }
    get is_EffectEndEv() { return this.$tag === 5; }
    get is_WouldDoEv() { return this.$tag === 6; }
    get is_PageEv() { return this.$tag === 7; }
    get is_WouldPageEv() { return this.$tag === 8; }
    get is_TransferEv() { return this.$tag === 9; }
    get is_OutcomeEv() { return this.$tag === 10; }
    get dtor_cmd() { return this.cmd; }
    get dtor_exit() { return this.exit; }
    get dtor_timedOut() { return this.timedOut; }
    get dtor_afterWouldDo() { return this.afterWouldDo; }
    get dtor_expr() { return this.expr; }
    get dtor_left() { return this.left; }
    get dtor_right() { return this.right; }
    get dtor_result() { return this.result; }
    get dtor_question() { return this.question; }
    get dtor_kind() { return this.kind; }
    get dtor_probs() { return this.probs; }
    get dtor_chosen() { return this.chosen; }
    get dtor_confidence() { return this.confidence; }
    get dtor_sure() { return this.sure; }
    get dtor_passed() { return this.passed; }
    get dtor_range() { return this.range; }
    get dtor_detail() { return this.detail; }
    get dtor_text() { return this.text; }
    get dtor_ok() { return this.ok; }
    get dtor_from() { return this.from; }
    get dtor_to() { return this.to; }
    get dtor_outcome() { return this.outcome; }
    get dtor_askCalls() { return this.askCalls; }
    get dtor_effects() { return this.effects; }
    get dtor_dry() { return this.dry; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.EventBody.RunEv" + "(" + this.cmd.toVerbatimString(true) + ", " + _dafny.toString(this.exit) + ", " + _dafny.toString(this.timedOut) + ", " + _dafny.toString(this.afterWouldDo) + ")";
      } else if (this.$tag === 1) {
        return "SkopStep.EventBody.CheckCmdEv" + "(" + this.cmd.toVerbatimString(true) + ", " + _dafny.toString(this.exit) + ", " + _dafny.toString(this.timedOut) + ", " + _dafny.toString(this.afterWouldDo) + ")";
      } else if (this.$tag === 2) {
        return "SkopStep.EventBody.CheckEv" + "(" + this.expr.toVerbatimString(true) + ", " + _dafny.toString(this.left) + ", " + _dafny.toString(this.right) + ", " + _dafny.toString(this.result) + ", " + _dafny.toString(this.afterWouldDo) + ")";
      } else if (this.$tag === 3) {
        return "SkopStep.EventBody.AskEv" + "(" + this.question.toVerbatimString(true) + ", " + _dafny.toString(this.kind) + ", " + _dafny.toString(this.probs) + ", " + _dafny.toString(this.chosen) + ", " + _dafny.toString(this.confidence) + ", " + _dafny.toString(this.sure) + ", " + _dafny.toString(this.passed) + ", " + _dafny.toString(this.range) + ", " + _dafny.toString(this.detail) + ", " + _dafny.toString(this.afterWouldDo) + ")";
      } else if (this.$tag === 4) {
        return "SkopStep.EventBody.EffectStartEv" + "(" + this.cmd.toVerbatimString(true) + ")";
      } else if (this.$tag === 5) {
        return "SkopStep.EventBody.EffectEndEv" + "(" + this.cmd.toVerbatimString(true) + ", " + _dafny.toString(this.exit) + ", " + _dafny.toString(this.timedOut) + ")";
      } else if (this.$tag === 6) {
        return "SkopStep.EventBody.WouldDoEv" + "(" + this.cmd.toVerbatimString(true) + ")";
      } else if (this.$tag === 7) {
        return "SkopStep.EventBody.PageEv" + "(" + this.text.toVerbatimString(true) + ", " + _dafny.toString(this.ok) + ")";
      } else if (this.$tag === 8) {
        return "SkopStep.EventBody.WouldPageEv" + "(" + this.text.toVerbatimString(true) + ")";
      } else if (this.$tag === 9) {
        return "SkopStep.EventBody.TransferEv" + "(" + this.from.toVerbatimString(true) + ", " + this.to.toVerbatimString(true) + ")";
      } else if (this.$tag === 10) {
        return "SkopStep.EventBody.OutcomeEv" + "(" + _dafny.toString(this.outcome) + ", " + _dafny.toString(this.askCalls) + ", " + _dafny.toString(this.effects) + ", " + _dafny.toString(this.dry) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.cmd, other.cmd) && _dafny.areEqual(this.exit, other.exit) && this.timedOut === other.timedOut && this.afterWouldDo === other.afterWouldDo;
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.cmd, other.cmd) && _dafny.areEqual(this.exit, other.exit) && this.timedOut === other.timedOut && this.afterWouldDo === other.afterWouldDo;
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.expr, other.expr) && _dafny.areEqual(this.left, other.left) && _dafny.areEqual(this.right, other.right) && _dafny.areEqual(this.result, other.result) && this.afterWouldDo === other.afterWouldDo;
      } else if (this.$tag === 3) {
        return other.$tag === 3 && _dafny.areEqual(this.question, other.question) && _dafny.areEqual(this.kind, other.kind) && _dafny.areEqual(this.probs, other.probs) && _dafny.areEqual(this.chosen, other.chosen) && _dafny.areEqual(this.confidence, other.confidence) && _dafny.areEqual(this.sure, other.sure) && this.passed === other.passed && _dafny.areEqual(this.range, other.range) && _dafny.areEqual(this.detail, other.detail) && this.afterWouldDo === other.afterWouldDo;
      } else if (this.$tag === 4) {
        return other.$tag === 4 && _dafny.areEqual(this.cmd, other.cmd);
      } else if (this.$tag === 5) {
        return other.$tag === 5 && _dafny.areEqual(this.cmd, other.cmd) && _dafny.areEqual(this.exit, other.exit) && this.timedOut === other.timedOut;
      } else if (this.$tag === 6) {
        return other.$tag === 6 && _dafny.areEqual(this.cmd, other.cmd);
      } else if (this.$tag === 7) {
        return other.$tag === 7 && _dafny.areEqual(this.text, other.text) && this.ok === other.ok;
      } else if (this.$tag === 8) {
        return other.$tag === 8 && _dafny.areEqual(this.text, other.text);
      } else if (this.$tag === 9) {
        return other.$tag === 9 && _dafny.areEqual(this.from, other.from) && _dafny.areEqual(this.to, other.to);
      } else if (this.$tag === 10) {
        return other.$tag === 10 && _dafny.areEqual(this.outcome, other.outcome) && _dafny.areEqual(this.askCalls, other.askCalls) && _dafny.areEqual(this.effects, other.effects) && this.dry === other.dry;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.EventBody.create_RunEv(_dafny.Seq.UnicodeFromString(""), SkopAst.Option.Default(), false, false);
    }
    static Rtd() {
      return class {
        static get Default() {
          return EventBody.Default();
        }
      };
    }
  }

  $module.CoreEvent = class CoreEvent {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_CoreEvent(at, body) {
      let $dt = new CoreEvent(0);
      $dt.at = at;
      $dt.body = body;
      return $dt;
    }
    get is_CoreEvent() { return this.$tag === 0; }
    get dtor_at() { return this.at; }
    get dtor_body() { return this.body; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.CoreEvent.CoreEvent" + "(" + _dafny.toString(this.at) + ", " + _dafny.toString(this.body) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.at, other.at) && _dafny.areEqual(this.body, other.body);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.CoreEvent.create_CoreEvent(SkopAst.Option.Default(), SkopStep.EventBody.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return CoreEvent.Default();
        }
      };
    }
  }

  $module.Mode = class Mode {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Concrete() {
      let $dt = new Mode(0);
      return $dt;
    }
    static create_Explore() {
      let $dt = new Mode(1);
      return $dt;
    }
    get is_Concrete() { return this.$tag === 0; }
    get is_Explore() { return this.$tag === 1; }
    static get AllSingletonConstructors() {
      return this.AllSingletonConstructors_();
    }
    static *AllSingletonConstructors_() {
      yield Mode.create_Concrete();
      yield Mode.create_Explore();
    }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.Mode.Concrete";
      } else if (this.$tag === 1) {
        return "SkopStep.Mode.Explore";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.Mode.create_Concrete();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Mode.Default();
        }
      };
    }
  }

  $module.RunConfig = class RunConfig {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_RunConfig(params, builtins, dry, mode) {
      let $dt = new RunConfig(0);
      $dt.params = params;
      $dt.builtins = builtins;
      $dt.dry = dry;
      $dt.mode = mode;
      return $dt;
    }
    get is_RunConfig() { return this.$tag === 0; }
    get dtor_params() { return this.params; }
    get dtor_builtins() { return this.builtins; }
    get dtor_dry() { return this.dry; }
    get dtor_mode() { return this.mode; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.RunConfig.RunConfig" + "(" + _dafny.toString(this.params) + ", " + _dafny.toString(this.builtins) + ", " + _dafny.toString(this.dry) + ", " + _dafny.toString(this.mode) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.params, other.params) && _dafny.areEqual(this.builtins, other.builtins) && this.dry === other.dry && _dafny.areEqual(this.mode, other.mode);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.RunConfig.create_RunConfig(_dafny.Map.Empty, _dafny.Map.Empty, false, SkopStep.Mode.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return RunConfig.Default();
        }
      };
    }
  }

  $module.LintError = class LintError {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_LintError(code, src) {
      let $dt = new LintError(0);
      $dt.code = code;
      $dt.src = src;
      return $dt;
    }
    get is_LintError() { return this.$tag === 0; }
    get dtor_code() { return this.code; }
    get dtor_src() { return this.src; }
    toString() {
      if (this.$tag === 0) {
        return "SkopStep.LintError.LintError" + "(" + this.code.toVerbatimString(true) + ", " + _dafny.toString(this.src) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.code, other.code) && _dafny.areEqual(this.src, other.src);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopStep.LintError.create_LintError(_dafny.Seq.UnicodeFromString(""), _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return LintError.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module SkopStep
let SkopCheck = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "SkopCheck._default";
    }
    _parentTraits() {
      return [];
    }
    static Err(code, src) {
      return SkopStep.LintError.create_LintError(code, src);
    };
    static UnionSeq(xs, f) {
      let _0___accumulator = _dafny.Set.fromElements();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((xs).length)).isEqualTo(_dafny.ZERO)) {
          return (_dafny.Set.fromElements()).Union(_0___accumulator);
        } else {
          _0___accumulator = (_0___accumulator).Union((f)((xs)[_dafny.ZERO]));
          let _in0 = (xs).slice(_dafny.ONE);
          let _in1 = f;
          xs = _in0;
          f = _in1;
          continue TAIL_CALL_START;
        }
      }
    };
    static OverSections(p, f) {
      let _0_ids = SkopCheck.__default.Ids(p);
      let _1_m = function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of (_0_ids).Elements) {
          let _2_id = _compr_0;
          if ((_0_ids).contains(_2_id)) {
            _coll0.push([_2_id,(f)(_2_id)]);
          }
        }
        return _coll0;
      }();
      return function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_1 of (_1_m).Keys.Elements) {
          let _3_id = _compr_1;
          if ((_1_m).contains(_3_id)) {
            for (const _compr_2 of ((_1_m).get(_3_id)).Elements) {
              let _4_e = _compr_2;
              if (((_1_m).get(_3_id)).contains(_4_e)) {
                _coll1.add(_4_e);
              }
            }
          }
        }
        return _coll1;
      }();
    };
    static FlatOf(p, f) {
      return ((_0_p, _1_f) => function (_2_id) {
        return ((SkopWellFormed.__default.IsInstr(_0_p, _2_id)) ? (SkopCheck.__default.UnionSeq(SkopWellFormed.__default.Flat(SkopWellFormed.__default.Body(_0_p, _2_id)), _1_f)) : (_dafny.Set.fromElements()));
      })(p, f);
    };
    static OverStmts(p, f) {
      return SkopCheck.__default.OverSections(p, SkopCheck.__default.FlatOf(p, f));
    };
    static Lint(p) {
      return SkopCheck.__default.Sorted(SkopCheck.__default.Errors(p, SkopCheck.__default.Analyse(p)));
    };
    static Warnings(p) {
      return SkopCheck.__default.Sorted(SkopCheck.__default.WarningsWith(p, SkopCheck.__default.Analyse(p)));
    };
    static LintAll(p) {
      let _0_f = SkopCheck.__default.Analyse(p);
      return _dafny.Tuple.of(SkopCheck.__default.Sorted(SkopCheck.__default.Errors(p, _0_f)), SkopCheck.__default.Sorted(SkopCheck.__default.WarningsWith(p, _0_f)));
    };
    static Analyse(p) {
      let _0_reach = SkopCheck.__default.Reaches(p);
      return SkopCheck.Facts.create_Facts(_0_reach, SkopCheck.__default.InEnvs(p, _0_reach));
    };
    static Errors(p, f) {
      let _0_cycles = SkopCheck.__default.CycleErrs(p, (f).dtor_reach);
      let _1_actions = SkopCheck.__default.ActionErrs(p);
      return (((((((((SkopCheck.__default.EntryErrs(p)).Union(SkopCheck.__default.RefErrs(p))).Union(SkopCheck.__default.ListErrs(p))).Union(_0_cycles)).Union(SkopCheck.__default.StructErrs(p))).Union(SkopCheck.__default.ChecksErrs(p))).Union(SkopCheck.__default.AskErrs(p))).Union(SkopCheck.__default.NameErrs(p))).Union(_1_actions)).Union((((_0_cycles).equals(_dafny.Set.fromElements())) ? (SkopCheck.__default.FlowErrs(p, (f).dtor_In, (_1_actions).equals(_dafny.Set.fromElements()))) : (_dafny.Set.fromElements())));
    };
    static EntryErrs(p) {
      if (SkopWellFormed.__default.IsInstr(p, ((p).dtor_entry).dtor_section)) {
        return _dafny.Set.fromElements();
      } else if (((p).dtor_sections).contains(((p).dtor_entry).dtor_section)) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-REF-KIND"), ((p).dtor_entry).dtor_src));
      } else {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNRESOLVED"), ((p).dtor_entry).dtor_src));
      }
    };
    static TargetErrs(p, r, src) {
      if ((!(SkopWellFormed.__default.AnchorOk(r))) || (!((p).dtor_sections).contains((r).dtor_id))) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNRESOLVED"), src));
      } else if (!(SkopWellFormed.__default.IsInstr(p, (r).dtor_id))) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-REF-KIND"), src));
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static ListRefErrs(p, r, src) {
      if ((!(SkopWellFormed.__default.AnchorOk(r))) || (!((p).dtor_sections).contains((r).dtor_id))) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNRESOLVED"), src));
      } else if ((((p).dtor_sections).get((r).dtor_id)).is_Instructions) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-REF-KIND"), src));
      } else if (!(SkopWellFormed.__default.IsData(p, (r).dtor_id))) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-SECTION-KIND"), src));
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static StmtRefErrs(p, s) {
      let _0_jumps = SkopWellFormed.__default.Jumps(s);
      return (function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_0_jumps).Elements) {
          let _1_j = _compr_0;
          if ((_0_jumps).contains(_1_j)) {
            for (const _compr_1 of (SkopCheck.__default.TargetErrs(p, (_1_j).dtor_ref, (_1_j).dtor_src)).Elements) {
              let _2_e = _compr_1;
              if ((SkopCheck.__default.TargetErrs(p, (_1_j).dtor_ref, (_1_j).dtor_src)).contains(_2_e)) {
                _coll0.add(_2_e);
              }
            }
          }
        }
        return _coll0;
      }()).Union(function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_2 of (SkopWellFormed.__default.ListRefs(s)).Elements) {
          let _3_r = _compr_2;
          if ((SkopWellFormed.__default.ListRefs(s)).contains(_3_r)) {
            for (const _compr_3 of (SkopCheck.__default.ListRefErrs(p, _3_r, (s).dtor_src)).Elements) {
              let _4_e = _compr_3;
              if ((SkopCheck.__default.ListRefErrs(p, _3_r, (s).dtor_src)).contains(_4_e)) {
                _coll1.add(_4_e);
              }
            }
          }
        }
        return _coll1;
      }());
    };
    static RefErrs(p) {
      return SkopCheck.__default.OverStmts(p, SkopCheck.__default.RefsOf(p));
    };
    static RefsOf(p) {
      return ((_0_p) => function (_1_s) {
        return SkopCheck.__default.StmtRefErrs(_0_p, _1_s);
      })(p);
    };
    static DataListErrs(l) {
      let _pat_let_tv0 = l;
      let _pat_let_tv1 = l;
      let _pat_let_tv2 = l;
      let _pat_let_tv3 = l;
      let _pat_let_tv4 = l;
      if ((new BigNumber(((l).dtor_items).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-LIST-EMPTY"), (l).dtor_src));
      } else {
        return (function (_pat_let0_0) {
          return function (_0_odd) {
            return ((_dafny.Quantifier(((_pat_let_tv2).dtor_items).UniqueElements, true, function (_forall_var_0) {
              let _2_i = _forall_var_0;
              return !(_dafny.Seq.contains((_pat_let_tv3).dtor_items, _2_i)) || (((_2_i).is_Action) === ((((_pat_let_tv4).dtor_items)[_dafny.ZERO]).is_Action));
            })) ? (_dafny.Set.fromElements()) : (function () {
              let _coll0 = new _dafny.Set();
              for (const _compr_0 of ((_pat_let_tv0).dtor_items).Elements) {
                let _1_i = _compr_0;
                if ((_dafny.Seq.contains((_pat_let_tv1).dtor_items, _1_i)) && (((_1_i).is_Action) === (_0_odd))) {
                  _coll0.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-LIST-MIXED"), (_1_i).dtor_src));
                }
              }
              return _coll0;
            }()));
          }(_pat_let0_0);
        }(SkopCheck.__default.MinorityIsAction((l).dtor_items))).Union(function () {
          let _coll1 = new _dafny.Set();
          for (const _compr_1 of _dafny.IntegerRange(_dafny.ZERO, new BigNumber(((l).dtor_items).length))) {
            let _3_a = _compr_1;
            if ((_dafny.ZERO).isLessThanOrEqualTo(_3_a)) {
              for (const _compr_2 of _dafny.IntegerRange((_3_a).plus(_dafny.ONE), new BigNumber(((l).dtor_items).length))) {
                let _4_b = _compr_2;
                if ((((_3_a).isLessThan(_4_b)) && ((_4_b).isLessThan(new BigNumber(((l).dtor_items).length)))) && (_dafny.areEqual(SkopWellFormed.__default.Lower(SkopWellFormed.__default.Label(((l).dtor_items)[_3_a])), SkopWellFormed.__default.Lower(SkopWellFormed.__default.Label(((l).dtor_items)[_4_b]))))) {
                  _coll1.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-LIST-DUP"), (((l).dtor_items)[_4_b]).dtor_src));
                }
              }
            }
          }
          return _coll1;
        }());
      }
    };
    static MinorityIsAction(items) {
      let _0_actions = new BigNumber((function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of _dafny.IntegerRange(_dafny.ZERO, new BigNumber((items).length))) {
          let _1_k = _compr_0;
          if ((((_dafny.ZERO).isLessThanOrEqualTo(_1_k)) && ((_1_k).isLessThan(new BigNumber((items).length)))) && (((items)[_1_k]).is_Action)) {
            _coll0.add(_1_k);
          }
        }
        return _coll0;
      }()).length);
      if (((new BigNumber(2)).multipliedBy(_0_actions)).isEqualTo(new BigNumber((items).length))) {
        return !(((items)[_dafny.ZERO]).is_Action);
      } else {
        return ((new BigNumber(2)).multipliedBy(_0_actions)).isLessThan(new BigNumber((items).length));
      }
    };
    static StmtListErrs(p, s) {
      return (((((s).is_ForEach) && (SkopWellFormed.__default.IsData(p, ((s).dtor_list).dtor_id))) ? (SkopCheck.__default.DataListErrs(SkopWellFormed.__default.DataList(p, ((s).dtor_list).dtor_id))) : ((((((s).is_Ask) && (((s).dtor_form).is_OneOf)) && (SkopWellFormed.__default.IsData(p, (((s).dtor_form).dtor_list).dtor_id))) ? (SkopCheck.__default.DataListErrs(SkopWellFormed.__default.DataList(p, (((s).dtor_form).dtor_list).dtor_id))) : (_dafny.Set.fromElements()))))).Union(((((((s).is_Ask) && (((s).dtor_form).is_OneOf)) && (SkopWellFormed.__default.IsData(p, (((s).dtor_form).dtor_list).dtor_id))) && (_dafny.Quantifier(((SkopWellFormed.__default.DataList(p, (((s).dtor_form).dtor_list).dtor_id)).dtor_items).UniqueElements, false, function (_exists_var_0) {
        let _0_i = _exists_var_0;
        return (_dafny.Seq.contains((SkopWellFormed.__default.DataList(p, (((s).dtor_form).dtor_list).dtor_id)).dtor_items, _0_i)) && ((_0_i).is_Action);
      }))) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-LIST-KIND"), (s).dtor_src))) : (_dafny.Set.fromElements())));
    };
    static ListErrs(p) {
      return SkopCheck.__default.OverStmts(p, SkopCheck.__default.ListsOf(p));
    };
    static ListsOf(p) {
      return ((_0_p) => function (_1_s) {
        return SkopCheck.__default.StmtListErrs(_0_p, _1_s);
      })(p);
    };
    static Ids(p) {
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of ((p).dtor_sections).Keys.Elements) {
          let _0_id = _compr_0;
          if ((((p).dtor_sections).contains(_0_id)) && ((((p).dtor_sections).get(_0_id)).is_Instructions)) {
            _coll0.add(_0_id);
          }
        }
        return _coll0;
      }();
    };
    static Succ(p, id) {
      let _0_jumps = SkopCheck.__default.AllJumps(SkopWellFormed.__default.Flat(SkopWellFormed.__default.Body(p, id)));
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_0_jumps).Elements) {
          let _1_j = _compr_0;
          if (((_0_jumps).contains(_1_j)) && (SkopWellFormed.__default.IsInstr(p, ((_1_j).dtor_ref).dtor_id))) {
            _coll0.add(((_1_j).dtor_ref).dtor_id);
          }
        }
        return _coll0;
      }();
    };
    static AllJumps(flat) {
      let _0___accumulator = _dafny.Set.fromElements();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((flat).length)).isEqualTo(_dafny.ZERO)) {
          return (_dafny.Set.fromElements()).Union(_0___accumulator);
        } else {
          _0___accumulator = (_0___accumulator).Union(SkopWellFormed.__default.Jumps((flat)[_dafny.ZERO]));
          let _in0 = (flat).slice(_dafny.ONE);
          flat = _in0;
          continue TAIL_CALL_START;
        }
      }
    };
    static SuccMap(p) {
      let _0_ids = SkopCheck.__default.Ids(p);
      return function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of (_0_ids).Elements) {
          let _1_id = _compr_0;
          if ((_0_ids).contains(_1_id)) {
            _coll0.push([_1_id,SkopCheck.__default.Succ(p, _1_id)]);
          }
        }
        return _coll0;
      }();
    };
    static Closure(p, succ, v, frontier) {
      TAIL_CALL_START: while (true) {
        let _0_n = (function () {
          let _coll0 = new _dafny.Set();
          for (const _compr_0 of (frontier).Elements) {
            let _1_id = _compr_0;
            if ((frontier).contains(_1_id)) {
              for (const _compr_1 of ((succ).get(_1_id)).Elements) {
                let _2_t = _compr_1;
                if (((succ).get(_1_id)).contains(_2_t)) {
                  _coll0.add(_2_t);
                }
              }
            }
          }
          return _coll0;
        }()).Difference(v);
        if ((_0_n).equals(_dafny.Set.fromElements())) {
          return v;
        } else {
          let _in0 = p;
          let _in1 = succ;
          let _in2 = (v).Union(_0_n);
          let _in3 = _0_n;
          p = _in0;
          succ = _in1;
          v = _in2;
          frontier = _in3;
          continue TAIL_CALL_START;
        }
      }
    };
    static Reach(p, succ, id) {
      return SkopCheck.__default.Closure(p, succ, _dafny.Set.fromElements(id), _dafny.Set.fromElements(id));
    };
    static Reaches(p) {
      let _0_ids = SkopCheck.__default.Ids(p);
      let _1_succ = SkopCheck.__default.SuccMap(p);
      return function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of (_0_ids).Elements) {
          let _2_id = _compr_0;
          if ((_0_ids).contains(_2_id)) {
            _coll0.push([_2_id,SkopCheck.__default.Reach(p, _1_succ, _2_id)]);
          }
        }
        return _coll0;
      }();
    };
    static CycleErrs(p, reach) {
      let _0_jumps = SkopCheck.__default.SectionJumps(p);
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_0_jumps).Keys.Elements) {
          let _1_id = _compr_0;
          if ((_0_jumps).contains(_1_id)) {
            for (const _compr_1 of ((_0_jumps).get(_1_id)).Elements) {
              let _2_j = _compr_1;
              if (((((_0_jumps).get(_1_id)).contains(_2_j)) && ((reach).contains(((_2_j).dtor_ref).dtor_id))) && (((reach).get(((_2_j).dtor_ref).dtor_id)).contains(_1_id))) {
                _coll0.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-CYCLE"), (_2_j).dtor_src));
              }
            }
          }
        }
        return _coll0;
      }();
    };
    static SectionJumps(p) {
      let _0_ids = SkopCheck.__default.Ids(p);
      return function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of (_0_ids).Elements) {
          let _1_id = _compr_0;
          if ((_0_ids).contains(_1_id)) {
            _coll0.push([_1_id,SkopCheck.__default.AllJumps(SkopWellFormed.__default.Flat(SkopWellFormed.__default.Body(p, _1_id)))]);
          }
        }
        return _coll0;
      }();
    };
    static Ranks(reach) {
      return function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of (reach).Keys.Elements) {
          let _0_id = _compr_0;
          if ((reach).contains(_0_id)) {
            _coll0.push([_0_id,new BigNumber(((reach).get(_0_id)).length)]);
          }
        }
        return _coll0;
      }();
    };
    static DeadErrs(body) {
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of _dafny.IntegerRange(_dafny.ZERO, (new BigNumber((body).length)).minus(_dafny.ONE))) {
          let _0_i = _compr_0;
          if ((((_dafny.ZERO).isLessThanOrEqualTo(_0_i)) && ((_0_i).isLessThan((new BigNumber((body).length)).minus(_dafny.ONE)))) && (SkopWellFormed.__default.Terminal((body)[_0_i]))) {
            _coll0.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNREACHABLE"), ((body)[(_0_i).plus(_dafny.ONE)]).dtor_src));
          }
        }
        return _coll0;
      }();
    };
    static SectionStructErrs(src, body) {
      return (((((new BigNumber((body).length)).isEqualTo(_dafny.ZERO)) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-FALLS-OFF"), src))) : (((!(SkopWellFormed.__default.Terminal((body)[(new BigNumber((body).length)).minus(_dafny.ONE)]))) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-FALLS-OFF"), ((body)[(new BigNumber((body).length)).minus(_dafny.ONE)]).dtor_src))) : (_dafny.Set.fromElements()))))).Union(SkopCheck.__default.DeadErrs(body))).Union(SkopCheck.__default.UnionSeq(SkopWellFormed.__default.Flat(body), SkopCheck.__default.LoopDead));
    };
    static LoopDead(s) {
      if ((s).is_ForEach) {
        return SkopCheck.__default.DeadErrs((s).dtor_body);
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static StructErrs(p) {
      return SkopCheck.__default.OverSections(p, SkopCheck.__default.StructOf(p));
    };
    static StructOf(p) {
      return ((_0_p) => function (_1_id) {
        return ((SkopWellFormed.__default.IsInstr(_0_p, _1_id)) ? (SkopCheck.__default.SectionStructErrs((((_0_p).dtor_sections).get(_1_id)).dtor_src, SkopWellFormed.__default.Body(_0_p, _1_id))) : (_dafny.Set.fromElements()));
      })(p);
    };
    static CheckFindings(s) {
      if ((((s).is_Check) && (((s).dtor_onTrue).is_None)) && (((s).dtor_els).is_NoElse)) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-GRAMMAR"), (s).dtor_src));
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static ChecksErrs(p) {
      return SkopCheck.__default.OverStmts(p, SkopCheck.__default.CheckFindings);
    };
    static RubricErrs(src, low, high, rubric) {
      return ((function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (rubric).Elements) {
          let _0_r = _compr_0;
          if ((_dafny.Seq.contains(rubric, _0_r)) && (!(((low).isLessThanOrEqualTo((_0_r).dtor_level)) && (((_0_r).dtor_level).isLessThanOrEqualTo(high))))) {
            _coll0.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-SCORE-RUBRIC"), (_0_r).dtor_src));
          }
        }
        return _coll0;
      }()).Union(function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_1 of _dafny.IntegerRange(_dafny.ZERO, new BigNumber((rubric).length))) {
          let _1_a = _compr_1;
          if ((_dafny.ZERO).isLessThanOrEqualTo(_1_a)) {
            for (const _compr_2 of _dafny.IntegerRange((_1_a).plus(_dafny.ONE), new BigNumber((rubric).length))) {
              let _2_b = _compr_2;
              if ((((_1_a).isLessThan(_2_b)) && ((_2_b).isLessThan(new BigNumber((rubric).length)))) && ((((rubric)[_1_a]).dtor_level).isEqualTo(((rubric)[_2_b]).dtor_level))) {
                _coll1.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-SCORE-RUBRIC"), ((rubric)[_2_b]).dtor_src));
              }
            }
          }
        }
        return _coll1;
      }())).Union(function () {
        let _coll2 = new _dafny.Set();
        for (const _compr_3 of _dafny.IntegerRange(low, (high).plus(_dafny.ONE))) {
          let _3_level = _compr_3;
          if ((((low).isLessThanOrEqualTo(_3_level)) && ((_3_level).isLessThanOrEqualTo(high))) && (!(SkopWellFormed.__default.Levels(rubric)).contains(_3_level))) {
            _coll2.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-SCORE-RUBRIC"), src));
          }
        }
        return _coll2;
      }());
    };
    static AskErrsOf(s) {
      return ((((((s).dtor_els).is_Skip) && (!(((s).dtor_form).is_YesNo))) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-ELSE-SKIP"), (s).dtor_src))) : (_dafny.Set.fromElements()))).Union(function () {
        let _source0 = (s).dtor_form;
        {
          if (_source0.is_Sections) {
            let _0_opts = (_source0).options;
            return (((((new BigNumber((_0_opts).length)).isLessThan(new BigNumber(2))) || ((new BigNumber(255)).isLessThan(new BigNumber((_0_opts).length)))) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-OPTION-COUNT"), (s).dtor_src))) : (_dafny.Set.fromElements()))).Union(function () {
              let _coll0 = new _dafny.Set();
              for (const _compr_0 of _dafny.IntegerRange(_dafny.ZERO, new BigNumber((_0_opts).length))) {
                let _1_a = _compr_0;
                if ((_dafny.ZERO).isLessThanOrEqualTo(_1_a)) {
                  for (const _compr_1 of _dafny.IntegerRange((_1_a).plus(_dafny.ONE), new BigNumber((_0_opts).length))) {
                    let _2_b = _compr_1;
                    if ((((_1_a).isLessThan(_2_b)) && ((_2_b).isLessThan(new BigNumber((_0_opts).length)))) && (_dafny.areEqual((((_0_opts)[_1_a]).dtor_ref).dtor_id, (((_0_opts)[_2_b]).dtor_ref).dtor_id))) {
                      _coll0.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-OPTION-COUNT"), ((_0_opts)[_2_b]).dtor_src));
                    }
                  }
                }
              }
              return _coll0;
            }());
          }
        }
        {
          if (_source0.is_Score) {
            let _3_low = (_source0).low;
            let _4_high = (_source0).high;
            let _5_rubric = (_source0).rubric;
            if (!((((_dafny.ZERO).isLessThanOrEqualTo(_3_low)) && ((_3_low).isLessThan(_4_high))) && (((_4_high).minus(_3_low)).isLessThan(new BigNumber(10))))) {
              return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-SCORE-RANGE"), (s).dtor_src));
            } else {
              return SkopCheck.__default.RubricErrs((s).dtor_src, _3_low, _4_high, _5_rubric);
            }
          }
        }
        {
          return _dafny.Set.fromElements();
        }
      }());
    };
    static AskErrs(p) {
      return SkopCheck.__default.OverStmts(p, SkopCheck.__default.AskFindings);
    };
    static AskFindings(s) {
      if ((s).is_Ask) {
        return SkopCheck.__default.AskErrsOf(s);
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static NameErrs(p) {
      let _0_all = SkopWellFormed.__default.AllNames(p);
      let _1_stmts = SkopWellFormed.__default.Stmts(p);
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_1_stmts).Elements) {
          let _2_s = _compr_0;
          if ((_1_stmts).contains(_2_s)) {
            for (const _compr_1 of (SkopWellFormed.__default.TextVars(_2_s)).Elements) {
              let _3_x = _compr_1;
              if (((SkopWellFormed.__default.TextVars(_2_s)).contains(_3_x)) && (!(_0_all).contains(_3_x))) {
                _coll0.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNBOUND"), (_2_s).dtor_src));
              }
            }
          }
        }
        return _coll0;
      }();
    };
    static ActionVarErrs(p, rebound, y, src) {
      if (!((((p).dtor_params).Keys).Union(SkopWellFormed.__default.Builtins)).contains(y)) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err((((rebound).contains(y)) ? (_dafny.Seq.UnicodeFromString("E-TAINT")) : (_dafny.Seq.UnicodeFromString("E-UNBOUND"))), src));
      } else if ((rebound).contains(y)) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-TAINT"), src));
      } else if ((((p).dtor_params).contains(y)) && (!(SkopWellFormed.__default.SafeParam(((p).dtor_params).get(y))))) {
        return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNSAFE-VALUE"), (((p).dtor_params).get(y)).dtor_src));
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static ActionFindings(p, rebound) {
      return ((_0_p, _1_rebound) => function (_2_s) {
        return ((((_2_s).is_ForEach) && (SkopWellFormed.__default.IsData(_0_p, ((_2_s).dtor_list).dtor_id))) ? (function () {
          let _coll0 = new _dafny.Set();
          for (const _compr_0 of ((SkopWellFormed.__default.DataList(_0_p, ((_2_s).dtor_list).dtor_id)).dtor_items).Elements) {
            let _3_i = _compr_0;
            if ((_dafny.Seq.contains((SkopWellFormed.__default.DataList(_0_p, ((_2_s).dtor_list).dtor_id)).dtor_items, _3_i)) && ((_3_i).is_Action)) {
              for (const _compr_1 of (SkopWellFormed.__default.PartVars((_3_i).dtor_cmd)).Elements) {
                let _4_y = _compr_1;
                if ((SkopWellFormed.__default.PartVars((_3_i).dtor_cmd)).contains(_4_y)) {
                  for (const _compr_2 of (SkopCheck.__default.ActionVarErrs(_0_p, _1_rebound, _4_y, (_3_i).dtor_src)).Elements) {
                    let _5_e = _compr_2;
                    if ((SkopCheck.__default.ActionVarErrs(_0_p, _1_rebound, _4_y, (_3_i).dtor_src)).contains(_5_e)) {
                      _coll0.add(_5_e);
                    }
                  }
                }
              }
            }
          }
          return _coll0;
        }()) : (_dafny.Set.fromElements()));
      })(p, rebound);
    };
    static ActionErrs(p) {
      return SkopCheck.__default.OverStmts(p, SkopCheck.__default.ActionFindings(p, SkopWellFormed.__default.Rebound(p)));
    };
    static AddIn(a, b) {
      return function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of (((a).Keys).Union((b).Keys)).Elements) {
          let _0_t = _compr_0;
          if ((((a).Keys).Union((b).Keys)).contains(_0_t)) {
            _coll0.push([_0_t,((((a).contains(_0_t)) ? ((a).get(_0_t)) : (_dafny.Set.fromElements()))).Union((((b).contains(_0_t)) ? ((b).get(_0_t)) : (_dafny.Set.fromElements())))]);
          }
        }
        return _coll0;
      }();
    };
    static Outs(p, body, e, lv) {
      if ((new BigNumber((body).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Map.Empty.slice();
      } else {
        let _0_s = (body)[_dafny.ZERO];
        let _1_jumps = SkopWellFormed.__default.Jumps(_0_s);
        let _2_out = SkopWellFormed.__default.Forget(e, (lv).Union(SkopWellFormed.__default.BindingSet(_0_s)));
        let _3_targets = function () {
          let _coll0 = new _dafny.Set();
          for (const _compr_0 of (_1_jumps).Elements) {
            let _4_j = _compr_0;
            if ((_1_jumps).contains(_4_j)) {
              _coll0.add(((_4_j).dtor_ref).dtor_id);
            }
          }
          return _coll0;
        }();
        let _5_here = function () {
          let _coll1 = new _dafny.Map();
          for (const _compr_1 of (_3_targets).Elements) {
            let _6_t = _compr_1;
            if ((_3_targets).contains(_6_t)) {
              _coll1.push([_6_t,_dafny.Set.fromElements(_2_out)]);
            }
          }
          return _coll1;
        }();
        return SkopCheck.__default.AddIn(SkopCheck.__default.AddIn(_5_here, (((_0_s).is_ForEach) ? (SkopCheck.__default.Outs(p, (_0_s).dtor_body, SkopWellFormed.__default.LoopEntry(p, _0_s, e), (lv).Union(_dafny.Set.fromElements((_0_s).dtor_loopVar)))) : (_dafny.Map.Empty.slice()))), SkopCheck.__default.Outs(p, (body).slice(_dafny.ONE), SkopWellFormed.__default.After(p, _0_s, e), lv));
      }
    };
    static Meet(es) {
      let _0_names = function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (es).Elements) {
          let _1_e = _compr_0;
          if ((es).contains(_1_e)) {
            for (const _compr_1 of ((_1_e).dtor_kinds).Keys.Elements) {
              let _2_x = _compr_1;
              if (((_1_e).dtor_kinds).contains(_2_x)) {
                _coll0.add(_2_x);
              }
            }
          }
        }
        return _coll0;
      }();
      return SkopWellFormed.Env.create_Env(function () {
  let _coll1 = new _dafny.Set();
  for (const _compr_2 of (es).Elements) {
    let _3_e = _compr_2;
    if ((es).contains(_3_e)) {
      for (const _compr_3 of ((_3_e).dtor_bound).Elements) {
        let _4_x = _compr_3;
        if ((((_3_e).dtor_bound).contains(_4_x)) && (_dafny.Quantifier((es).Elements, true, function (_forall_var_0) {
          let _5_f = _forall_var_0;
          return !((es).contains(_5_f)) || (((_5_f).dtor_bound).contains(_4_x));
        }))) {
          _coll1.add(_4_x);
        }
      }
    }
  }
  return _coll1;
}(), function () {
  let _coll2 = new _dafny.Map();
  for (const _compr_4 of (_0_names).Elements) {
    let _6_x = _compr_4;
    if ((_0_names).contains(_6_x)) {
      _coll2.push([_6_x,function () {
        let _coll3 = new _dafny.Set();
        for (const _compr_5 of (es).Elements) {
          let _7_e = _compr_5;
          if (((es).contains(_7_e)) && (((_7_e).dtor_kinds).contains(_6_x))) {
            for (const _compr_6 of (((_7_e).dtor_kinds).get(_6_x)).Elements) {
              let _8_k = _compr_6;
              if ((((_7_e).dtor_kinds).get(_6_x)).contains(_8_k)) {
                _coll3.add(_8_k);
              }
            }
          }
        }
        return _coll3;
      }()]);
    }
  }
  return _coll2;
}());
    };
    static InLayers(p, byRank, n, k) {
      let _pat_let_tv0 = p;
      if ((n).isLessThan(k)) {
        return _dafny.Tuple.of(_dafny.Map.Empty.slice(), _dafny.Map.Empty.slice());
      } else {
        let _let_tmp_rhs0 = SkopCheck.__default.InLayers(p, byRank, n, (k).plus(_dafny.ONE));
        let _0_done = (_let_tmp_rhs0)[0];
        let _1_incoming = (_let_tmp_rhs0)[1];
        if (!(byRank).contains(k)) {
          return _dafny.Tuple.of(_0_done, _1_incoming);
        } else {
          let _2_layer = function () {
            let _coll0 = new _dafny.Map();
            for (const _compr_0 of ((byRank).get(k)).Elements) {
              let _3_t = _compr_0;
              if (((byRank).get(k)).contains(_3_t)) {
                _coll0.push([_3_t,function (_pat_let1_0) {
                  return function (_4_es) {
                    return (((_4_es).equals(_dafny.Set.fromElements())) ? (SkopWellFormed.__default.EntryEnv(_pat_let_tv0)) : (SkopCheck.__default.Meet(_4_es)));
                  }(_pat_let1_0);
                }(((((_1_incoming).contains(_3_t)) ? ((_1_incoming).get(_3_t)) : (_dafny.Set.fromElements()))).Union(((_dafny.areEqual(_3_t, ((p).dtor_entry).dtor_section)) ? (_dafny.Set.fromElements(SkopWellFormed.__default.EntryEnv(p))) : (_dafny.Set.fromElements()))))]);
              }
            }
            return _coll0;
          }();
          let _5_outsOf = function () {
            let _coll1 = new _dafny.Map();
            for (const _compr_1 of (_2_layer).Keys.Elements) {
              let _6_t = _compr_1;
              if (((_2_layer).contains(_6_t)) && (SkopWellFormed.__default.IsInstr(p, _6_t))) {
                _coll1.push([_6_t,SkopCheck.__default.Outs(p, SkopWellFormed.__default.Body(p, _6_t), (_2_layer).get(_6_t), _dafny.Set.fromElements())]);
              }
            }
            return _coll1;
          }();
          let _7_targets = function () {
            let _coll2 = new _dafny.Set();
            for (const _compr_2 of (_5_outsOf).Keys.Elements) {
              let _8_u = _compr_2;
              if ((_5_outsOf).contains(_8_u)) {
                for (const _compr_3 of ((_5_outsOf).get(_8_u)).Keys.Elements) {
                  let _9_t = _compr_3;
                  if (((_5_outsOf).get(_8_u)).contains(_9_t)) {
                    _coll2.add(_9_t);
                  }
                }
              }
            }
            return _coll2;
          }();
          let _10_more = function () {
            let _coll3 = new _dafny.Map();
            for (const _compr_4 of (_7_targets).Elements) {
              let _11_t = _compr_4;
              if ((_7_targets).contains(_11_t)) {
                _coll3.push([_11_t,function () {
                  let _coll4 = new _dafny.Set();
                  for (const _compr_5 of (_5_outsOf).Keys.Elements) {
                    let _12_u = _compr_5;
                    if (((_5_outsOf).contains(_12_u)) && (((_5_outsOf).get(_12_u)).contains(_11_t))) {
                      for (const _compr_6 of (((_5_outsOf).get(_12_u)).get(_11_t)).Elements) {
                        let _13_e = _compr_6;
                        if ((((_5_outsOf).get(_12_u)).get(_11_t)).contains(_13_e)) {
                          _coll4.add(_13_e);
                        }
                      }
                    }
                  }
                  return _coll4;
                }()]);
              }
            }
            return _coll3;
          }();
          return _dafny.Tuple.of((_0_done).Merge(_2_layer), SkopCheck.__default.AddIn(_1_incoming, _10_more));
        }
      }
    };
    static InEnvs(p, reach) {
      let _0_live = (((reach).contains(((p).dtor_entry).dtor_section)) ? ((reach).get(((p).dtor_entry).dtor_section)) : (_dafny.Set.fromElements()));
      let _1_rank = function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of (_0_live).Elements) {
          let _2_id = _compr_0;
          if (((_0_live).contains(_2_id)) && ((reach).contains(_2_id))) {
            _coll0.push([_2_id,new BigNumber(((reach).get(_2_id)).length)]);
          }
        }
        return _coll0;
      }();
      let _3_ranks = function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_1 of (_1_rank).Keys.Elements) {
          let _4_id = _compr_1;
          if ((_1_rank).contains(_4_id)) {
            _coll1.add((_1_rank).get(_4_id));
          }
        }
        return _coll1;
      }();
      let _5_byRank = function () {
        let _coll2 = new _dafny.Map();
        for (const _compr_2 of (_3_ranks).Elements) {
          let _6_k = _compr_2;
          if (_System.nat._Is(_6_k)) {
            if ((_3_ranks).contains(_6_k)) {
              _coll2.push([_6_k,function () {
                let _coll3 = new _dafny.Set();
                for (const _compr_3 of (_1_rank).Keys.Elements) {
                  let _7_id = _compr_3;
                  if (((_1_rank).contains(_7_id)) && (((_1_rank).get(_7_id)).isEqualTo(_6_k))) {
                    _coll3.add(_7_id);
                  }
                }
                return _coll3;
              }()]);
            }
          }
        }
        return _coll2;
      }();
      let _8_layers = (SkopCheck.__default.InLayers(p, _5_byRank, new BigNumber((_0_live).length), _dafny.ONE))[0];
      return function () {
        let _coll4 = new _dafny.Map();
        for (const _compr_4 of (_0_live).Elements) {
          let _9_id = _compr_4;
          if ((_0_live).contains(_9_id)) {
            _coll4.push([_9_id,(((_8_layers).contains(_9_id)) ? ((_8_layers).get(_9_id)) : (SkopWellFormed.__default.EntryEnv(p)))]);
          }
        }
        return _coll4;
      }();
    };
    static CmdVarErrs(p, e, x, src) {
      let _0_ks = SkopWellFormed.__default.KindsOf(e, x);
      return ((((((!((e).dtor_bound).contains(x)) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNBOUND"), src))) : (_dafny.Set.fromElements()))).Union((((_0_ks).contains(SkopWellFormed.Kind.create_KRun())) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-TAINT"), src))) : (_dafny.Set.fromElements())))).Union(((_dafny.Quantifier((_0_ks).Elements, false, function (_exists_var_0) {
        let _1_k = _exists_var_0;
        return ((_0_ks).contains(_1_k)) && ((_1_k).is_KAction);
      })) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-ACTION-IN-CMD"), src))) : (_dafny.Set.fromElements())))).Union(((((_0_ks).contains(SkopWellFormed.Kind.create_KParam())) && (!((((p).dtor_params).contains(x)) && (SkopWellFormed.__default.SafeParam(((p).dtor_params).get(x)))))) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNSAFE-VALUE"), ((((p).dtor_params).contains(x)) ? ((((p).dtor_params).get(x)).dtor_src) : (src))))) : (_dafny.Set.fromElements())))).Union(function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_0_ks).Elements) {
          let _2_k = _compr_0;
          if ((((_0_ks).contains(_2_k)) && ((_2_k).is_KValue)) && (SkopWellFormed.__default.IsData(p, (_2_k).dtor_list))) {
            for (const _compr_1 of ((SkopWellFormed.__default.DataList(p, (_2_k).dtor_list)).dtor_items).Elements) {
              let _3_i = _compr_1;
              if (((_dafny.Seq.contains((SkopWellFormed.__default.DataList(p, (_2_k).dtor_list)).dtor_items, _3_i)) && ((_3_i).is_Value)) && (!(SkopWellFormed.__default.SafeValue((_3_i).dtor_value)))) {
                _coll0.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNSAFE-VALUE"), (_3_i).dtor_src));
              }
            }
          }
        }
        return _coll0;
      }());
    };
    static StmtErrs(p, act, In, s, e, lv, gov) {
      let _pat_let_tv0 = e;
      let _pat_let_tv1 = lv;
      let _pat_let_tv2 = s;
      let _pat_let_tv3 = In;
      let _pat_let_tv4 = In;
      return (((((((function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (SkopWellFormed.__default.CmdVars(s)).Elements) {
          let _0_x = _compr_0;
          if ((SkopWellFormed.__default.CmdVars(s)).contains(_0_x)) {
            for (const _compr_1 of (SkopCheck.__default.CmdVarErrs(p, e, _0_x, (s).dtor_src)).Elements) {
              let _1_err = _compr_1;
              if ((SkopCheck.__default.CmdVarErrs(p, e, _0_x, (s).dtor_src)).contains(_1_err)) {
                _coll0.add(_1_err);
              }
            }
          }
        }
        return _coll0;
      }()).Union(function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_2 of (SkopWellFormed.__default.OperandVars(s)).Elements) {
          let _2_x = _compr_2;
          if (((SkopWellFormed.__default.OperandVars(s)).contains(_2_x)) && (!((e).dtor_bound).contains(_2_x))) {
            _coll1.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNBOUND"), (s).dtor_src));
          }
        }
        return _coll1;
      }())).Union(function () {
        let _coll2 = new _dafny.Set();
        for (const _compr_3 of (SkopWellFormed.__default.DoItems(s)).Elements) {
          let _3_x = _compr_3;
          if (((SkopWellFormed.__default.DoItems(s)).contains(_3_x)) && (!((e).dtor_bound).contains(_3_x))) {
            _coll2.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNBOUND"), (s).dtor_src));
          }
        }
        return _coll2;
      }())).Union(function () {
        let _coll3 = new _dafny.Set();
        for (const _compr_4 of (SkopWellFormed.__default.DoItems(s)).Elements) {
          let _4_x = _compr_4;
          if ((SkopWellFormed.__default.DoItems(s)).contains(_4_x)) {
            for (const _compr_5 of (SkopWellFormed.__default.KindsOf(e, _4_x)).Elements) {
              let _5_k = _compr_5;
              if (((SkopWellFormed.__default.KindsOf(e, _4_x)).contains(_5_k)) && (!((_5_k).is_KAction))) {
                _coll3.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-LIST-KIND"), (s).dtor_src));
              }
            }
          }
        }
        return _coll3;
      }())).Union(function () {
        let _coll4 = new _dafny.Set();
        if (act) {
          for (const _compr_6 of (SkopWellFormed.__default.DoItems(s)).Elements) {
            let _6_x = _compr_6;
            if ((SkopWellFormed.__default.DoItems(s)).contains(_6_x)) {
              for (const _compr_7 of (SkopWellFormed.__default.KindsOf(e, _6_x)).Elements) {
                let _7_k = _compr_7;
                if (((SkopWellFormed.__default.KindsOf(e, _6_x)).contains(_7_k)) && ((_7_k).is_KAction)) {
                  for (const _compr_8 of (SkopCheck.__default.DoneCmdErrs(p, e, (_7_k).dtor_list)).Elements) {
                    let _8_err = _compr_8;
                    if ((SkopCheck.__default.DoneCmdErrs(p, e, (_7_k).dtor_list)).contains(_8_err)) {
                      _coll4.add(_8_err);
                    }
                  }
                }
              }
            }
          }
        }
        return _coll4;
      }())).Union((((((s).is_IfYesRun) || ((s).is_IfYesDo)) && (!((((gov).is_Some) && (((e).dtor_bound).contains((gov).dtor_value))) && ((SkopWellFormed.__default.KindsOf(e, (gov).dtor_value)).equals(_dafny.Set.fromElements(SkopWellFormed.Kind.create_KYesNo())))))) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-IF-YES"), (s).dtor_src))) : (_dafny.Set.fromElements())))).Union(function (_pat_let2_0) {
        return function (_9_jumps) {
          return function (_pat_let3_0) {
            return function (_10_out) {
              return function () {
                let _coll5 = new _dafny.Set();
                for (const _compr_9 of (_9_jumps).Elements) {
                  let _11_j = _compr_9;
                  if ((((_9_jumps).contains(_11_j)) && ((_pat_let_tv3).contains(((_11_j).dtor_ref).dtor_id))) && (!(SkopWellFormed.__default.Approx((_pat_let_tv4).get(((_11_j).dtor_ref).dtor_id), _10_out)))) {
                    _coll5.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNBOUND"), (_11_j).dtor_src));
                  }
                }
                return _coll5;
              }();
            }(_pat_let3_0);
          }(SkopWellFormed.__default.Forget(_pat_let_tv0, (_pat_let_tv1).Union(SkopWellFormed.__default.BindingSet(_pat_let_tv2))));
        }(_pat_let2_0);
      }(SkopWellFormed.__default.Jumps(s)))).Union(((!((s).is_ForEach)) ? (_dafny.Set.fromElements()) : (((!(SkopWellFormed.__default.IsData(p, ((s).dtor_list).dtor_id))) ? (SkopCheck.__default.ListRefErrs(p, (s).dtor_list, (s).dtor_src)) : ((((new BigNumber(((SkopWellFormed.__default.DataList(p, ((s).dtor_list).dtor_id)).dtor_items).length)).isEqualTo(_dafny.ZERO)) ? (SkopCheck.__default.DataListErrs(SkopWellFormed.__default.DataList(p, ((s).dtor_list).dtor_id))) : (SkopCheck.__default.SeqErrs(p, act, In, (s).dtor_body, SkopWellFormed.__default.LoopEntry(p, s, e), (lv).Union(_dafny.Set.fromElements((s).dtor_loopVar)), SkopAst.Option.create_None()))))))));
    };
    static DoneCmdErrs(p, e, list) {
      if (SkopWellFormed.__default.IsData(p, list)) {
        return function () {
          let _coll0 = new _dafny.Set();
          for (const _compr_0 of ((SkopWellFormed.__default.DataList(p, list)).dtor_items).Elements) {
            let _0_i = _compr_0;
            if ((_dafny.Seq.contains((SkopWellFormed.__default.DataList(p, list)).dtor_items, _0_i)) && ((_0_i).is_Action)) {
              for (const _compr_1 of (SkopWellFormed.__default.PartVars((_0_i).dtor_cmd)).Elements) {
                let _1_y = _compr_1;
                if ((SkopWellFormed.__default.PartVars((_0_i).dtor_cmd)).contains(_1_y)) {
                  for (const _compr_2 of (SkopCheck.__default.CmdVarErrs(p, e, _1_y, (_0_i).dtor_src)).Elements) {
                    let _2_err = _compr_2;
                    if ((SkopCheck.__default.CmdVarErrs(p, e, _1_y, (_0_i).dtor_src)).contains(_2_err)) {
                      _coll0.add(_2_err);
                    }
                  }
                }
              }
            }
          }
          return _coll0;
        }();
      } else {
        return _dafny.Set.fromElements();
      }
    };
    static SeqErrs(p, act, In, body, e, lv, gov) {
      if ((new BigNumber((body).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Set.fromElements();
      } else {
        return (SkopCheck.__default.StmtErrs(p, act, In, (body)[_dafny.ZERO], e, lv, gov)).Union(SkopCheck.__default.SeqErrs(p, act, In, (body).slice(_dafny.ONE), SkopWellFormed.__default.After(p, (body)[_dafny.ZERO], e), lv, SkopWellFormed.__default.NextGov((body)[_dafny.ZERO], gov)));
      }
    };
    static FlowErrs(p, In, act) {
      return (SkopCheck.__default.OverSections(p, SkopCheck.__default.FlowOf(p, In, act))).Union(((((In).contains(((p).dtor_entry).dtor_section)) && (!(SkopWellFormed.__default.Approx((In).get(((p).dtor_entry).dtor_section), SkopWellFormed.__default.EntryEnv(p))))) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("E-UNBOUND"), ((p).dtor_entry).dtor_src))) : (_dafny.Set.fromElements())));
    };
    static FlowOf(p, In, act) {
      return ((_0_p, _1_In, _2_act) => function (_3_id) {
        return (((SkopWellFormed.__default.IsInstr(_0_p, _3_id)) && ((_1_In).contains(_3_id))) ? (SkopCheck.__default.SeqErrs(_0_p, _2_act, _1_In, SkopWellFormed.__default.Body(_0_p, _3_id), (_1_In).get(_3_id), _dafny.Set.fromElements(), SkopAst.Option.create_None())) : (_dafny.Set.fromElements()));
      })(p, In, act);
    };
    static WarningsWith(p, f) {
      return (((SkopCheck.__default.UnreachedWarns(p, (f).dtor_reach)).Union(SkopCheck.__default.NoGuidanceWarns(p))).Union(SkopCheck.__default.ScoreWarns(p, (f).dtor_reach))).Union((((SkopCheck.__default.CycleErrs(p, (f).dtor_reach)).equals(_dafny.Set.fromElements())) ? (SkopCheck.__default.NoContextWarns(p, (f).dtor_In)) : (_dafny.Set.fromElements())));
    };
    static UnreachedWarns(p, reach) {
      if (!(reach).contains(((p).dtor_entry).dtor_section)) {
        return _dafny.Set.fromElements();
      } else {
        let _0_reached = (reach).get(((p).dtor_entry).dtor_section);
        return function () {
          let _coll0 = new _dafny.Set();
          for (const _compr_0 of (reach).Keys.Elements) {
            let _1_id = _compr_0;
            if ((((reach).contains(_1_id)) && (((p).dtor_sections).contains(_1_id))) && (!(_0_reached).contains(_1_id))) {
              _coll0.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("W-SECTION-UNREACHED"), (((p).dtor_sections).get(_1_id)).dtor_src));
            }
          }
          return _coll0;
        }();
      }
    };
    static NoGuidanceWarns(p) {
      let _0_stmts = SkopWellFormed.__default.Stmts(p);
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (_0_stmts).Elements) {
          let _1_s = _compr_0;
          if ((((_0_stmts).contains(_1_s)) && ((_1_s).is_Ask)) && (((_1_s).dtor_form).is_Sections)) {
            for (const _compr_1 of (((_1_s).dtor_form).dtor_options).Elements) {
              let _2_o = _compr_1;
              if (((_dafny.Seq.contains(((_1_s).dtor_form).dtor_options, _2_o)) && (SkopWellFormed.__default.IsInstr(p, ((_2_o).dtor_ref).dtor_id))) && (((((p).dtor_sections).get(((_2_o).dtor_ref).dtor_id)).dtor_guidance).is_None)) {
                _coll0.add(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("W-NO-GUIDANCE"), (((p).dtor_sections).get(((_2_o).dtor_ref).dtor_id)).dtor_src));
              }
            }
          }
        }
        return _coll0;
      }();
    };
    static NoContext(p, body, e) {
      if ((new BigNumber((body).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Set.fromElements();
      } else {
        let _0_s = (body)[_dafny.ZERO];
        return ((((((_0_s).is_Ask) && (_dafny.Quantifier((SkopWellFormed.__default.PartVars((_0_s).dtor_question)).Elements, true, function (_forall_var_0) {
          let _1_x = _forall_var_0;
          return !((SkopWellFormed.__default.PartVars((_0_s).dtor_question)).contains(_1_x)) || (!(SkopWellFormed.__default.KindsOf(e, _1_x)).contains(SkopWellFormed.Kind.create_KRun()));
        }))) ? (_dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("W-ASK-NO-CONTEXT"), (_0_s).dtor_src))) : (_dafny.Set.fromElements()))).Union((((_0_s).is_ForEach) ? (SkopCheck.__default.NoContext(p, (_0_s).dtor_body, SkopWellFormed.__default.LoopEntry(p, _0_s, e))) : (_dafny.Set.fromElements())))).Union(SkopCheck.__default.NoContext(p, (body).slice(_dafny.ONE), SkopWellFormed.__default.After(p, _0_s, e)));
      }
    };
    static NoContextWarns(p, In) {
      return SkopCheck.__default.OverSections(p, ((_0_p, _1_In) => function (_2_id) {
        return (((SkopWellFormed.__default.IsInstr(_0_p, _2_id)) && ((_1_In).contains(_2_id))) ? (SkopCheck.__default.NoContext(_0_p, SkopWellFormed.__default.Body(_0_p, _2_id), (_1_In).get(_2_id))) : (_dafny.Set.fromElements()));
      })(p, In));
    };
    static Uses(s, x) {
      let _0_parts = function () {
        let _source0 = s;
        {
          if (_source0.is_Run) {
            let _1_cmd = (_source0).cmd;
            return _1_cmd;
          }
        }
        {
          if (_source0.is_Do) {
            let action0 = (_source0).action;
            if (action0.is_DoCmd) {
              let _2_cmd = (action0).cmd;
              return _2_cmd;
            }
          }
        }
        {
          if (_source0.is_Check) {
            let cond0 = (_source0).cond;
            if (cond0.is_Succeeds) {
              let _3_cmd = (cond0).cmd;
              return _3_cmd;
            }
          }
        }
        {
          if (_source0.is_Ask) {
            let _4_q = (_source0).question;
            return _4_q;
          }
        }
        {
          if (_source0.is_IfYesRun) {
            let _5_cmd = (_source0).cmd;
            return _5_cmd;
          }
        }
        {
          if (_source0.is_IfYesDo) {
            let action1 = (_source0).action;
            if (action1.is_DoCmd) {
              let _6_cmd = (action1).cmd;
              return _6_cmd;
            }
          }
        }
        {
          if (_source0.is_Page) {
            let _7_text = (_source0).text;
            return _7_text;
          }
        }
        {
          return _dafny.Seq.of();
        }
      }();
      return ((((_dafny.MultiSet.FromArray(_0_parts)).get(SkopAst.Part.create_Var(x))).plus((((((s).is_Check) && (((s).dtor_cond).is_Cmp)) && (_dafny.areEqual(((s).dtor_cond).dtor_l, SkopAst.Operand.create_VarOp(x)))) ? (_dafny.ONE) : (_dafny.ZERO)))).plus((((((s).is_Check) && (((s).dtor_cond).is_Cmp)) && (_dafny.areEqual(((s).dtor_cond).dtor_r, SkopAst.Operand.create_VarOp(x)))) ? (_dafny.ONE) : (_dafny.ZERO)))).plus((((SkopWellFormed.__default.DoItems(s)).contains(x)) ? (_dafny.ONE) : (_dafny.ZERO)));
    };
    static Threshold(s, x) {
      return (((s).is_Check) && (((s).dtor_cond).is_Cmp)) && (((_dafny.areEqual(((s).dtor_cond).dtor_l, SkopAst.Operand.create_VarOp(x))) && ((((s).dtor_cond).dtor_r).is_Num)) || ((_dafny.areEqual(((s).dtor_cond).dtor_r, SkopAst.Operand.create_VarOp(x))) && ((((s).dtor_cond).dtor_l).is_Num)));
    };
    static ScoreWarns(p, reach) {
      return SkopCheck.__default.OverSections(p, ((_0_p, _1_reach) => function (_2_id) {
        return (((SkopWellFormed.__default.IsInstr(_0_p, _2_id)) && ((_1_reach).contains(_2_id))) ? (SkopCheck.__default.ScoreWarnsIn(_0_p, _1_reach, _2_id, SkopWellFormed.__default.Flat(SkopWellFormed.__default.Body(_0_p, _2_id)), _dafny.ZERO)) : (_dafny.Set.fromElements()));
      })(p, reach));
    };
    static ScoreWarnsIn(p, reach, id, flat, i) {
      let _0___accumulator = _dafny.Set.fromElements();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((flat).length)).isLessThanOrEqualTo(i)) {
          return (_dafny.Set.fromElements()).Union(_0___accumulator);
        } else {
          _0___accumulator = (_0___accumulator).Union(SkopCheck.__default.ScoreWarn(p, reach, id, flat, i));
          let _in0 = p;
          let _in1 = reach;
          let _in2 = id;
          let _in3 = flat;
          let _in4 = (i).plus(_dafny.ONE);
          p = _in0;
          reach = _in1;
          id = _in2;
          flat = _in3;
          i = _in4;
          continue TAIL_CALL_START;
        }
      }
    };
    static ScoreWarn(p, reach, id, flat, i) {
      let _0_s = (flat)[i];
      if (!(((_0_s).is_Ask) && (((_0_s).dtor_form).is_Score))) {
        return _dafny.Set.fromElements();
      } else {
        let _1_x = ((_0_s).dtor_form).dtor_binding;
        let _2_later = (function () {
          let _coll0 = new _dafny.Set();
          for (const _compr_0 of _dafny.IntegerRange((i).plus(_dafny.ONE), new BigNumber((flat).length))) {
            let _3_j = _compr_0;
            if (((i).isLessThan(_3_j)) && ((_3_j).isLessThan(new BigNumber((flat).length)))) {
              _coll0.add((flat)[_3_j]);
            }
          }
          return _coll0;
        }()).Union(function () {
          let _coll1 = new _dafny.Set();
          for (const _compr_1 of ((reach).get(id)).Elements) {
            let _4_t = _compr_1;
            if (((((reach).get(id)).contains(_4_t)) && (!_dafny.areEqual(_4_t, id))) && (SkopWellFormed.__default.IsInstr(p, _4_t))) {
              for (const _compr_2 of (SkopWellFormed.__default.Flat(SkopWellFormed.__default.Body(p, _4_t))).Elements) {
                let _5_u = _compr_2;
                if (_dafny.Seq.contains(SkopWellFormed.__default.Flat(SkopWellFormed.__default.Body(p, _4_t)), _5_u)) {
                  _coll1.add(_5_u);
                }
              }
            }
          }
          return _coll1;
        }());
        let _6_users = function () {
          let _coll2 = new _dafny.Set();
          for (const _compr_3 of (_2_later).Elements) {
            let _7_u = _compr_3;
            if (((_2_later).contains(_7_u)) && ((_dafny.ZERO).isLessThan(SkopCheck.__default.Uses(_7_u, _1_x)))) {
              _coll2.add(_7_u);
            }
          }
          return _coll2;
        }();
        if ((_6_users).equals(_dafny.Set.fromElements())) {
          return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("W-SCORE-UNUSED"), (_0_s).dtor_src));
        } else if (_dafny.Quantifier((_6_users).Elements, false, function (_exists_var_0) {
          let _8_u = _exists_var_0;
          return ((_6_users).contains(_8_u)) && ((((_6_users).equals(_dafny.Set.fromElements(_8_u))) && ((SkopCheck.__default.Uses(_8_u, _1_x)).isEqualTo(_dafny.ONE))) && (SkopCheck.__default.Threshold(_8_u, _1_x)));
        })) {
          return _dafny.Set.fromElements(SkopCheck.__default.Err(_dafny.Seq.UnicodeFromString("W-SCORE-THRESHOLD"), (_0_s).dtor_src));
        } else {
          return _dafny.Set.fromElements();
        }
      }
    };
    static StrLe(a, b) {
      return ((new BigNumber((a).length)).isEqualTo(_dafny.ZERO)) || (((_dafny.ZERO).isLessThan(new BigNumber((b).length))) && ((((a)[_dafny.ZERO]).isLessThan((b)[_dafny.ZERO])) || ((_dafny.areEqual((a)[_dafny.ZERO], (b)[_dafny.ZERO])) && (SkopCheck.__default.StrLe((a).slice(_dafny.ONE), (b).slice(_dafny.ONE))))));
    };
    static ErrLe(a, b) {
      return (((a).dtor_src).isLessThan((b).dtor_src)) || ((((a).dtor_src).isEqualTo((b).dtor_src)) && (SkopCheck.__default.StrLe((a).dtor_code, (b).dtor_code)));
    };
    static Sorted(s) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        let _pat_let_tv0 = s;
        if ((s).equals(_dafny.Set.fromElements())) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of());
        } else {
          return function (_let_dummy_4) {
            let _1_m = undefined;
            L_ASSIGN_SUCH_THAT_0: {
              for (const _assign_such_that_0 of (s).Elements) {
                _1_m = _assign_such_that_0;
                if (((s).contains(_1_m)) && (_dafny.Quantifier((s).Elements, true, function (_forall_var_0) {
                  let _2_x = _forall_var_0;
                  return !((s).contains(_2_x)) || (SkopCheck.__default.ErrLe(_1_m, _2_x));
                }))) {
                  break L_ASSIGN_SUCH_THAT_0;
                }
              }
              throw new Error("assign-such-that search produced no value");
            }
            return _dafny.Seq.Concat(_dafny.Seq.of(_1_m), SkopCheck.__default.Sorted((_pat_let_tv0).Difference(_dafny.Set.fromElements(_1_m))));
          }(0);
        }
      }
    };
  };

  $module.Facts = class Facts {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Facts(reach, In) {
      let $dt = new Facts(0);
      $dt.reach = reach;
      $dt.In = In;
      return $dt;
    }
    get is_Facts() { return this.$tag === 0; }
    get dtor_reach() { return this.reach; }
    get dtor_In() { return this.In; }
    toString() {
      if (this.$tag === 0) {
        return "SkopCheck.Facts.Facts" + "(" + _dafny.toString(this.reach) + ", " + _dafny.toString(this.In) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.reach, other.reach) && _dafny.areEqual(this.In, other.In);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopCheck.Facts.create_Facts(_dafny.Map.Empty, _dafny.Map.Empty);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Facts.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module SkopCheck
let SkopValues = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "SkopValues._default";
    }
    _parentTraits() {
      return [];
    }
    static Digit(d) {
      return new _dafny.CodePoint(((new BigNumber((new _dafny.CodePoint('0'.codePointAt(0))).value)).plus(d)).toNumber());
    };
    static NatToString(n) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((n).isLessThan(new BigNumber(10))) {
          return _dafny.Seq.Concat(_dafny.Seq.of(SkopValues.__default.Digit(n)), _0___accumulator);
        } else {
          _0___accumulator = _dafny.Seq.Concat(_dafny.Seq.of(SkopValues.__default.Digit((n).mod(new BigNumber(10)))), _0___accumulator);
          let _in0 = _dafny.EuclideanDivision(n, new BigNumber(10));
          n = _in0;
          continue TAIL_CALL_START;
        }
      }
    };
    static IntToString(i) {
      if ((i).isLessThan(_dafny.ZERO)) {
        return _dafny.Seq.Concat(_dafny.Seq.UnicodeFromString("-"), SkopValues.__default.NatToString((_dafny.ZERO).minus(i)));
      } else {
        return SkopValues.__default.NatToString(i);
      }
    };
    static Show(v) {
      let _source0 = v;
      {
        if (_source0.is_Str) {
          let _0_s = (_source0).s;
          return _0_s;
        }
      }
      {
        let _1_i = (_source0).i;
        return SkopValues.__default.IntToString(_1_i);
      }
    };
    static IsDigit(c) {
      return ((new _dafny.CodePoint('0'.codePointAt(0))).isLessThanOrEqual(c)) && ((c).isLessThanOrEqual(new _dafny.CodePoint('9'.codePointAt(0))));
    };
    static AllDigits(s) {
      return ((_dafny.ZERO).isLessThan(new BigNumber((s).length))) && (_dafny.Quantifier((s).UniqueElements, true, function (_forall_var_0) {
        let _0_c = _forall_var_0;
        return !(_dafny.Seq.contains(s, _0_c)) || (SkopValues.__default.IsDigit(_0_c));
      }));
    };
    static Space(c) {
      return (((_dafny.areEqual(c, new _dafny.CodePoint(' '.codePointAt(0)))) || (_dafny.areEqual(c, new _dafny.CodePoint('\t'.codePointAt(0))))) || (_dafny.areEqual(c, new _dafny.CodePoint('\n'.codePointAt(0))))) || (_dafny.areEqual(c, new _dafny.CodePoint('\r'.codePointAt(0))));
    };
    static TrimStart(s) {
      TAIL_CALL_START: while (true) {
        if (((_dafny.ZERO).isLessThan(new BigNumber((s).length))) && (SkopValues.__default.Space((s)[_dafny.ZERO]))) {
          let _in0 = (s).slice(_dafny.ONE);
          s = _in0;
          continue TAIL_CALL_START;
        } else {
          return s;
        }
      }
    };
    static TrimEnd(s) {
      TAIL_CALL_START: while (true) {
        if (((_dafny.ZERO).isLessThan(new BigNumber((s).length))) && (SkopValues.__default.Space((s)[(new BigNumber((s).length)).minus(_dafny.ONE)]))) {
          let _in0 = (s).slice(0, (new BigNumber((s).length)).minus(_dafny.ONE));
          s = _in0;
          continue TAIL_CALL_START;
        } else {
          return s;
        }
      }
    };
    static Trim(s) {
      return SkopValues.__default.TrimEnd(SkopValues.__default.TrimStart(s));
    };
    static StripPct(s) {
      if (((_dafny.ZERO).isLessThan(new BigNumber((s).length))) && (_dafny.areEqual((s)[(new BigNumber((s).length)).minus(_dafny.ONE)], new _dafny.CodePoint('%'.codePointAt(0))))) {
        return (s).slice(0, (new BigNumber((s).length)).minus(_dafny.ONE));
      } else {
        return s;
      }
    };
    static DigitsVal(s) {
      if ((new BigNumber((s).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.ZERO;
      } else {
        return ((SkopValues.__default.DigitsVal((s).slice(0, (new BigNumber((s).length)).minus(_dafny.ONE)))).multipliedBy(new BigNumber(10))).plus((new BigNumber(((s)[(new BigNumber((s).length)).minus(_dafny.ONE)]).value)).minus(new BigNumber((new _dafny.CodePoint('0'.codePointAt(0))).value)));
      }
    };
    static Pow10(n) {
      let _0___accumulator = _dafny.ONE;
      TAIL_CALL_START: while (true) {
        if ((n).isEqualTo(_dafny.ZERO)) {
          return (_dafny.ONE).multipliedBy(_0___accumulator);
        } else {
          _0___accumulator = (_0___accumulator).multipliedBy(new BigNumber(10));
          let _in0 = (n).minus(_dafny.ONE);
          n = _in0;
          continue TAIL_CALL_START;
        }
      }
    };
    static IndexOf(s, c) {
      let _0___accumulator = _dafny.ZERO;
      TAIL_CALL_START: while (true) {
        if (((new BigNumber((s).length)).isEqualTo(_dafny.ZERO)) || (_dafny.areEqual((s)[_dafny.ZERO], c))) {
          return (_dafny.ZERO).plus(_0___accumulator);
        } else {
          _0___accumulator = (_0___accumulator).plus(_dafny.ONE);
          let _in0 = (s).slice(_dafny.ONE);
          let _in1 = c;
          s = _in0;
          c = _in1;
          continue TAIL_CALL_START;
        }
      }
    };
    static ParseNum(s) {
      let _0_neg = ((_dafny.ZERO).isLessThan(new BigNumber((s).length))) && (_dafny.areEqual((s)[_dafny.ZERO], new _dafny.CodePoint('-'.codePointAt(0))));
      let _1_t = ((_0_neg) ? ((s).slice(_dafny.ONE)) : (s));
      let _2_i = SkopValues.__default.IndexOf(_1_t, new _dafny.CodePoint('.'.codePointAt(0)));
      let _3_a = (_1_t).slice(0, _2_i);
      let _4_b = (((_2_i).isLessThan(new BigNumber((_1_t).length))) ? ((_1_t).slice((_2_i).plus(_dafny.ONE))) : (_dafny.Seq.UnicodeFromString("")));
      if ((!(SkopValues.__default.AllDigits(_3_a))) || (((_2_i).isLessThan(new BigNumber((_1_t).length))) && (!(SkopValues.__default.AllDigits(_4_b))))) {
        return SkopAst.Option.create_None();
      } else {
        let _5_v = (new _dafny.BigRational((SkopValues.__default.DigitsVal(_3_a)), new BigNumber(1))).plus((new _dafny.BigRational((SkopValues.__default.DigitsVal(_4_b)), new BigNumber(1))).dividedBy(new _dafny.BigRational((SkopValues.__default.Pow10(new BigNumber((_4_b).length))), new BigNumber(1))));
        return SkopAst.Option.create_Some(((_0_neg) ? ((new _dafny.BigRational(new BigNumber("0"))).minus(_5_v)) : (_5_v)));
      }
    };
    static NumText(v) {
      let _source0 = v;
      {
        if (_source0.is_Int) {
          let _0_i = (_source0).i;
          return SkopAst.Option.create_Some(SkopValues.__default.IntToString(_0_i));
        }
      }
      {
        let _1_s = (_source0).s;
        let _2_t = SkopValues.__default.StripPct(SkopValues.__default.Trim(_1_s));
        if ((SkopValues.__default.ParseNum(_2_t)).is_Some) {
          return SkopAst.Option.create_Some(_2_t);
        } else {
          return SkopAst.Option.create_None();
        }
      }
    };
    static Coerce(v) {
      let _source0 = v;
      {
        if (_source0.is_Int) {
          let _0_i = (_source0).i;
          return SkopAst.Option.create_Some(new _dafny.BigRational((_0_i), new BigNumber(1)));
        }
      }
      {
        let _1_s = (_source0).s;
        return SkopValues.__default.ParseNum(SkopValues.__default.StripPct(SkopValues.__default.Trim(_1_s)));
      }
    };
    static Compare(op, a, b) {
      let _source0 = op;
      {
        if (_source0.is_Lt) {
          return (a).isLessThan(b);
        }
      }
      {
        if (_source0.is_Le) {
          return (a).isAtMost(b);
        }
      }
      {
        if (_source0.is_Gt) {
          return (b).isLessThan(a);
        }
      }
      {
        if (_source0.is_Ge) {
          return (b).isAtMost(a);
        }
      }
      {
        if (_source0.is_Eq) {
          return (a).equals(b);
        }
      }
      {
        return !(a).equals(b);
      }
    };
    static Ids(opts) {
      return _dafny.Seq.Create(new BigNumber((opts).length), ((_0_opts) => function (_1_i) {
        return ((_0_opts)[_1_i]).dtor_id;
      })(opts));
    };
    static SumFirst(ids, probs, i) {
      let _0___accumulator = new _dafny.BigRational(new BigNumber("0"));
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((ids).length)).isLessThanOrEqualTo(i)) {
          return (new _dafny.BigRational(new BigNumber("0"))).plus(_0___accumulator);
        } else {
          _0___accumulator = (_0___accumulator).plus(((_dafny.Seq.contains((ids).slice(0, i), (ids)[i])) ? (new _dafny.BigRational(new BigNumber("0"))) : ((probs).get((ids)[i]))));
          let _in0 = ids;
          let _in1 = probs;
          let _in2 = (i).plus(_dafny.ONE);
          ids = _in0;
          probs = _in1;
          i = _in2;
          continue TAIL_CALL_START;
        }
      }
    };
    static InUnit(x) {
      return ((new _dafny.BigRational(new BigNumber("0"))).isAtMost(x)) && ((x).isAtMost(new _dafny.BigRational(new BigNumber("1"))));
    };
    static ValidAnswer(ids, probs, u) {
      return (((((_dafny.ZERO).isLessThan(new BigNumber((ids).length))) && (((probs).Keys).equals(function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (ids).Elements) {
          let _0_id = _compr_0;
          if (_dafny.Seq.contains(ids, _0_id)) {
            _coll0.add(_0_id);
          }
        }
        return _coll0;
      }()))) && (SkopValues.__default.InUnit(u))) && (_dafny.Quantifier((ids).UniqueElements, true, function (_forall_var_0) {
        let _1_id = _forall_var_0;
        return !(_dafny.Seq.contains(ids, _1_id)) || (SkopValues.__default.InUnit((probs).get(_1_id)));
      }))) && (((new _dafny.BigRational(new BigNumber(-1), new BigNumber("1000"))).isAtMost(((SkopValues.__default.SumFirst(ids, probs, _dafny.ZERO)).plus(u)).minus(new _dafny.BigRational(new BigNumber("1"))))) && ((((SkopValues.__default.SumFirst(ids, probs, _dafny.ZERO)).plus(u)).minus(new _dafny.BigRational(new BigNumber("1")))).isAtMost(new _dafny.BigRational(_dafny.ONE, new BigNumber("1000")))));
    };
    static Total(ids, probs, u) {
      return (SkopValues.__default.SumFirst(ids, probs, _dafny.ZERO)).plus(u);
    };
    static ArgMaxFrom(ids, probs, i, best) {
      TAIL_CALL_START: while (true) {
        if ((i).isEqualTo(new BigNumber((ids).length))) {
          return best;
        } else {
          let _in0 = ids;
          let _in1 = probs;
          let _in2 = (i).plus(_dafny.ONE);
          let _in3 = ((((probs).get((ids)[best])).isLessThan((probs).get((ids)[i]))) ? (i) : (best));
          ids = _in0;
          probs = _in1;
          i = _in2;
          best = _in3;
          continue TAIL_CALL_START;
        }
      }
    };
    static Gate(ids, probs, u, sure) {
      if (!(SkopValues.__default.ValidAnswer(ids, probs, u))) {
        return SkopValues.Verdict.create_Invalid();
      } else {
        let _0_t = SkopValues.__default.Total(ids, probs, u);
        let _1_c = SkopValues.__default.ArgMaxFrom(ids, probs, _dafny.ONE, _dafny.ZERO);
        let _2_conf = ((probs).get((ids)[_1_c])).dividedBy(_0_t);
        if ((((new _dafny.BigRational((sure), new BigNumber(1))).dividedBy(new _dafny.BigRational(new BigNumber("100")))).isAtMost(_2_conf)) && (_dafny.Quantifier(_dafny.IntegerRange(_dafny.ZERO, new BigNumber((ids).length)), true, function (_forall_var_0) {
          let _3_j = _forall_var_0;
          return !((((_dafny.ZERO).isLessThanOrEqualTo(_3_j)) && ((_3_j).isLessThan(new BigNumber((ids).length)))) && (!(_3_j).isEqualTo(_1_c))) || (((((probs).get((ids)[_3_j])).dividedBy(_0_t)).plus((u).dividedBy(_0_t))).isLessThan(_2_conf));
        }))) {
          return SkopValues.Verdict.create_Sure(_1_c, _2_conf);
        } else {
          return SkopValues.Verdict.create_Unsure(_1_c, _2_conf);
        }
      }
    };
  };

  $module.Verdict = class Verdict {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Invalid() {
      let $dt = new Verdict(0);
      return $dt;
    }
    static create_Unsure(chosen, conf) {
      let $dt = new Verdict(1);
      $dt.chosen = chosen;
      $dt.conf = conf;
      return $dt;
    }
    static create_Sure(chosen, conf) {
      let $dt = new Verdict(2);
      $dt.chosen = chosen;
      $dt.conf = conf;
      return $dt;
    }
    get is_Invalid() { return this.$tag === 0; }
    get is_Unsure() { return this.$tag === 1; }
    get is_Sure() { return this.$tag === 2; }
    get dtor_chosen() { return this.chosen; }
    get dtor_conf() { return this.conf; }
    toString() {
      if (this.$tag === 0) {
        return "SkopValues.Verdict.Invalid";
      } else if (this.$tag === 1) {
        return "SkopValues.Verdict.Unsure" + "(" + _dafny.toString(this.chosen) + ", " + _dafny.toString(this.conf) + ")";
      } else if (this.$tag === 2) {
        return "SkopValues.Verdict.Sure" + "(" + _dafny.toString(this.chosen) + ", " + _dafny.toString(this.conf) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0;
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.chosen, other.chosen) && _dafny.areEqual(this.conf, other.conf);
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.chosen, other.chosen) && _dafny.areEqual(this.conf, other.conf);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopValues.Verdict.create_Invalid();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Verdict.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module SkopValues
let SkopState = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "SkopState._default";
    }
    _parentTraits() {
      return [];
    }
    static ItemSlot(it) {
      return SkopState.Slot.create_Slot(SkopStep.Bound.create_Bound(SkopStep.Val.create_Str(SkopWellFormed.__default.Label(it)), SkopStep.Origin.create_FromListItem()), SkopAst.Option.create_Some(it));
    };
    static OpSrc(op) {
      let _source0 = op;
      {
        if (_source0.is_S) {
          let _0_st = (_source0).stmt;
          return (_0_st).dtor_src;
        }
      }
      {
        if (_source0.is_Bind) {
          let _1_src = (_source0).src;
          return _1_src;
        }
      }
      {
        let _2_src = (_source0).src;
        return _2_src;
      }
    };
    static Tasks(p, b, gov) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((b).length)).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of());
        } else {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of(SkopState.Task.create_Task(SkopState.Op.create_S((b)[_dafny.ZERO]), gov)));
          let _in0 = p;
          let _in1 = (b).slice(_dafny.ONE);
          let _in2 = SkopWellFormed.__default.NextGov((b)[_dafny.ZERO], gov);
          p = _in0;
          b = _in1;
          gov = _in2;
          continue TAIL_CALL_START;
        }
      }
    };
    static Iters(p, fe, items) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((items).length)).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of());
        } else {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.Concat(_dafny.Seq.of(SkopState.Task.create_Task(SkopState.Op.create_Bind((fe).dtor_loopVar, (items)[_dafny.ZERO], (fe).dtor_src), SkopAst.Option.create_None())), SkopState.__default.Tasks(p, (fe).dtor_body, SkopAst.Option.create_None())));
          let _in0 = p;
          let _in1 = fe;
          let _in2 = (items).slice(_dafny.ONE);
          p = _in0;
          fe = _in1;
          items = _in2;
          continue TAIL_CALL_START;
        }
      }
    };
    static Expand(p, t) {
      let _0_fe = ((t).dtor_op).dtor_stmt;
      return _dafny.Seq.Concat(SkopState.__default.Iters(p, _0_fe, (SkopWellFormed.__default.DataList(p, ((_0_fe).dtor_list).dtor_id)).dtor_items), _dafny.Seq.of(SkopState.Task.create_Task(SkopState.Op.create_Unbind((_0_fe).dtor_loopVar, (_0_fe).dtor_src), SkopAst.Option.create_None())));
    };
    static LoopVars(ts) {
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of _dafny.IntegerRange(_dafny.ZERO, new BigNumber((ts).length))) {
          let _0_k = _compr_0;
          if ((((_dafny.ZERO).isLessThanOrEqualTo(_0_k)) && ((_0_k).isLessThan(new BigNumber((ts).length)))) && ((((ts)[_0_k]).dtor_op).is_Unbind)) {
            _coll0.add((((ts)[_0_k]).dtor_op).dtor_v);
          }
        }
        return _coll0;
      }();
    };
    static IsDone(s) {
      return (((s).dtor_last).is_Some) && ((((s).dtor_last).dtor_value).is_Done);
    };
    static Pending(s) {
      return (((s).dtor_last).is_Some) && (!((((s).dtor_last).dtor_value).is_Done));
    };
    static Accepts(s, r) {
      return ((r).is_DeadlineExceeded) || (((((s).dtor_last).is_None) ? ((r).is_NoResponse) : (SkopStep.__default.Answers(((s).dtor_last).dtor_value, r))));
    };
    static CmdNames(p) {
      return (function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (SkopWellFormed.__default.Stmts(p)).Elements) {
          let _0_s = _compr_0;
          if ((SkopWellFormed.__default.Stmts(p)).contains(_0_s)) {
            for (const _compr_1 of (SkopWellFormed.__default.CmdVars(_0_s)).Elements) {
              let _1_x = _compr_1;
              if ((SkopWellFormed.__default.CmdVars(_0_s)).contains(_1_x)) {
                _coll0.add(_1_x);
              }
            }
          }
        }
        return _coll0;
      }()).Union(function () {
        let _coll1 = new _dafny.Set();
        for (const _compr_2 of ((p).dtor_sections).Keys.Elements) {
          let _2_id = _compr_2;
          if (((p).dtor_sections).contains(_2_id)) {
            for (const _compr_3 of (SkopWellFormed.__default.ActionVars(p, _2_id)).Elements) {
              let _3_y = _compr_3;
              if ((SkopWellFormed.__default.ActionVars(p, _2_id)).contains(_3_y)) {
                _coll1.add(_3_y);
              }
            }
          }
        }
        return _coll1;
      }());
    };
    static RunNames(p) {
      return function () {
        let _coll0 = new _dafny.Set();
        for (const _compr_0 of (SkopWellFormed.__default.Stmts(p)).Elements) {
          let _0_s = _compr_0;
          if ((((SkopWellFormed.__default.Stmts(p)).contains(_0_s)) && ((_0_s).is_Run)) && (((_0_s).dtor_binding).is_Some)) {
            _coll0.add(((_0_s).dtor_binding).dtor_value);
          }
        }
        return _coll0;
      }();
    };
    static InputsOk(p, cfg) {
      let _0_cn = SkopState.__default.CmdNames(p);
      return ((((((cfg).dtor_params).Keys).equals(((p).dtor_params).Keys)) && ((((cfg).dtor_builtins).Keys).equals(SkopWellFormed.__default.Builtins))) && (_dafny.Quantifier(((cfg).dtor_params).Keys.Elements, true, function (_forall_var_0) {
        let _1_x = _forall_var_0;
        return !((((cfg).dtor_params).contains(_1_x)) && ((_0_cn).contains(_1_x))) || (SkopWellFormed.__default.SafeValue(SkopValues.__default.Show(((cfg).dtor_params).get(_1_x))));
      }))) && (_dafny.Quantifier(((cfg).dtor_builtins).Keys.Elements, true, function (_forall_var_1) {
        let _2_x = _forall_var_1;
        return !((((cfg).dtor_builtins).contains(_2_x)) && ((_0_cn).contains(_2_x))) || (SkopWellFormed.__default.SafeValue(SkopValues.__default.Show(((cfg).dtor_builtins).get(_2_x))));
      }));
    };
    static IsRead(e) {
      return ((((e).is_RunEv) || ((e).is_CheckCmdEv)) || ((e).is_CheckEv)) || ((e).is_AskEv);
    };
    static CmdBound(vars, c) {
      return _dafny.Quantifier((c).UniqueElements, true, function (_forall_var_0) {
        let _0_pt = _forall_var_0;
        return !(_dafny.Seq.contains(c, _0_pt)) || (!((_0_pt).is_Var) || ((vars).contains((_0_pt).dtor_name)));
      });
    };
    static RenderCmd(vars, c) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((c).length)).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.UnicodeFromString(""));
        } else {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, ((((c)[_dafny.ZERO]).is_Lit) ? (((c)[_dafny.ZERO]).dtor_s) : (SkopValues.__default.Show((((vars).get(((c)[_dafny.ZERO]).dtor_name)).dtor_b).dtor_value))));
          let _in0 = vars;
          let _in1 = (c).slice(_dafny.ONE);
          vars = _in0;
          c = _in1;
          continue TAIL_CALL_START;
        }
      }
    };
    static RenderText(vars, c) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((c).length)).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.UnicodeFromString(""));
        } else {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, function () {
            let _source0 = (c)[_dafny.ZERO];
            {
              if (_source0.is_Lit) {
                let _1_l = (_source0).s;
                return _1_l;
              }
            }
            {
              let _2_x = (_source0).name;
              if ((vars).contains(_2_x)) {
                return SkopValues.__default.Show((((vars).get(_2_x)).dtor_b).dtor_value);
              } else {
                return SkopState.__default.Unavailable;
              }
            }
          }());
          let _in0 = vars;
          let _in1 = (c).slice(_dafny.ONE);
          vars = _in0;
          c = _in1;
          continue TAIL_CALL_START;
        }
      }
    };
    static QPart(rn, vars, x) {
      if ((vars).contains(x)) {
        if (_dafny.areEqual((((vars).get(x)).dtor_b).dtor_origin, SkopStep.Origin.create_FromRunOutput())) {
          return _dafny.Seq.Concat(_dafny.Seq.Concat(_dafny.Seq.UnicodeFromString("`"), x), _dafny.Seq.UnicodeFromString("`"));
        } else {
          return SkopValues.__default.Show((((vars).get(x)).dtor_b).dtor_value);
        }
      } else if ((rn).contains(x)) {
        return _dafny.Seq.Concat(_dafny.Seq.Concat(_dafny.Seq.UnicodeFromString("`"), x), _dafny.Seq.UnicodeFromString("`"));
      } else {
        return SkopState.__default.Unavailable;
      }
    };
    static RenderQ(rn, vars, q) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((q).length)).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.UnicodeFromString(""));
        } else {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, function () {
            let _source0 = (q)[_dafny.ZERO];
            {
              if (_source0.is_Lit) {
                let _1_l = (_source0).s;
                return _1_l;
              }
            }
            {
              let _2_x = (_source0).name;
              return SkopState.__default.QPart(rn, vars, _2_x);
            }
          }());
          let _in0 = rn;
          let _in1 = vars;
          let _in2 = (q).slice(_dafny.ONE);
          rn = _in0;
          vars = _in1;
          q = _in2;
          continue TAIL_CALL_START;
        }
      }
    };
    static InContext(rn, vars, x) {
      if ((vars).contains(x)) {
        return _dafny.areEqual((((vars).get(x)).dtor_b).dtor_origin, SkopStep.Origin.create_FromRunOutput());
      } else {
        return (rn).contains(x);
      }
    };
    static Context(rn, vars, q) {
      return function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of (SkopWellFormed.__default.PartVars(q)).Elements) {
          let _0_x = _compr_0;
          if (((SkopWellFormed.__default.PartVars(q)).contains(_0_x)) && (SkopState.__default.InContext(rn, vars, _0_x))) {
            _coll0.push([_0_x,(((vars).contains(_0_x)) ? (SkopValues.__default.Show((((vars).get(_0_x)).dtor_b).dtor_value)) : (SkopState.__default.Unavailable))]);
          }
        }
        return _coll0;
      }();
    };
    static RubricText(rubric, n) {
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((rubric).length)).isEqualTo(_dafny.ZERO)) {
          return SkopAst.Option.create_None();
        } else if ((((rubric)[_dafny.ZERO]).dtor_level).isEqualTo(n)) {
          return SkopAst.Option.create_Some(((rubric)[_dafny.ZERO]).dtor_text);
        } else {
          let _in0 = (rubric).slice(_dafny.ONE);
          let _in1 = n;
          rubric = _in0;
          n = _in1;
          continue TAIL_CALL_START;
        }
      }
    };
    static SectionOpts(p, opts) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((opts).length)).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of());
        } else {
          let _1_sec = ((p).dtor_sections).get((((opts)[_dafny.ZERO]).dtor_ref).dtor_id);
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of(SkopStep.AskOpt.create_AskOpt((((opts)[_dafny.ZERO]).dtor_ref).dtor_id, (_1_sec).dtor_name, (_1_sec).dtor_guidance)));
          let _in0 = p;
          let _in1 = (opts).slice(_dafny.ONE);
          p = _in0;
          opts = _in1;
          continue TAIL_CALL_START;
        }
      }
    };
    static ValueOpts(items) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((items).length)).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of());
        } else {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of(SkopStep.AskOpt.create_AskOpt(((items)[_dafny.ZERO]).dtor_value, ((items)[_dafny.ZERO]).dtor_value, SkopAst.Option.create_None())));
          let _in0 = (items).slice(_dafny.ONE);
          items = _in0;
          continue TAIL_CALL_START;
        }
      }
    };
    static LevelOpts(rubric, lo, n) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((n).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of());
        } else {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of(SkopStep.AskOpt.create_AskOpt(SkopValues.__default.IntToString(lo), SkopValues.__default.IntToString(lo), SkopState.__default.RubricText(rubric, lo))));
          let _in0 = rubric;
          let _in1 = (lo).plus(_dafny.ONE);
          let _in2 = (n).minus(_dafny.ONE);
          rubric = _in0;
          lo = _in1;
          n = _in2;
          continue TAIL_CALL_START;
        }
      }
    };
    static Options(p, form) {
      let _source0 = form;
      {
        if (_source0.is_Sections) {
          let _0_opts = (_source0).options;
          return SkopState.__default.SectionOpts(p, _0_opts);
        }
      }
      {
        if (_source0.is_YesNo) {
          return _dafny.Seq.of(SkopStep.AskOpt.create_AskOpt(_dafny.Seq.UnicodeFromString("yes"), _dafny.Seq.UnicodeFromString("yes"), SkopAst.Option.create_None()), SkopStep.AskOpt.create_AskOpt(_dafny.Seq.UnicodeFromString("no"), _dafny.Seq.UnicodeFromString("no"), SkopAst.Option.create_None()));
        }
      }
      {
        if (_source0.is_OneOf) {
          let _1_l = (_source0).list;
          return SkopState.__default.ValueOpts((SkopWellFormed.__default.DataList(p, (_1_l).dtor_id)).dtor_items);
        }
      }
      {
        let _2_lo = (_source0).low;
        let _3_hi = (_source0).high;
        let _4_rubric = (_source0).rubric;
        return SkopState.__default.LevelOpts(_4_rubric, _2_lo, ((_3_hi).minus(_2_lo)).plus(_dafny.ONE));
      }
    };
    static KindOf(form) {
      let _source0 = form;
      {
        if (_source0.is_Sections) {
          return SkopStep.AskKind.create_Choice();
        }
      }
      {
        if (_source0.is_YesNo) {
          return SkopStep.AskKind.create_YesNoKind();
        }
      }
      {
        if (_source0.is_OneOf) {
          return SkopStep.AskKind.create_Choice();
        }
      }
      {
        return SkopStep.AskKind.create_ScoreKind();
      }
    };
    static AskReq(p, sec, vars, rn, q, form) {
      return SkopStep.AskRequest.create_AskRequest(SkopState.__default.KindOf(form), SkopState.__default.RenderQ(rn, vars, q), (((p).dtor_sections).get(sec)).dtor_guidance, SkopState.__default.Options(p, form), SkopState.__default.Context(rn, vars, q), _dafny.ZERO);
    };
    static Yes(vars, gov) {
      return (((gov).is_Some) && ((vars).contains((gov).dtor_value))) && (_dafny.areEqual((((vars).get((gov).dtor_value)).dtor_b).dtor_value, SkopStep.Val.create_Str(_dafny.Seq.UnicodeFromString("yes"))));
    };
    static Unknown(vars, o) {
      return (((o).is_VarOp) && ((vars).contains((o).dtor_name))) && (_dafny.areEqual((((vars).get((o).dtor_name)).dtor_b).dtor_origin, SkopStep.Origin.create_FromRunOutput()));
    };
    static Issues(s) {
      let _0_t = ((s).dtor_tasks)[_dafny.ZERO];
      return (((_0_t).dtor_op).is_S) && (function () {
        let _source0 = ((_0_t).dtor_op).dtor_stmt;
        {
          if (_source0.is_Run) {
            return true;
          }
        }
        {
          if (_source0.is_Do) {
            return !(((s).dtor_cfg).dtor_dry);
          }
        }
        {
          if (_source0.is_Check) {
            let _1_cond = (_source0).cond;
            return ((_1_cond).is_Succeeds) || ((_dafny.areEqual(((s).dtor_cfg).dtor_mode, SkopStep.Mode.create_Explore())) && ((SkopState.__default.Unknown((s).dtor_vars, (_1_cond).dtor_l)) || (SkopState.__default.Unknown((s).dtor_vars, (_1_cond).dtor_r))));
          }
        }
        {
          if (_source0.is_Ask) {
            return true;
          }
        }
        {
          if (_source0.is_IfYesRun) {
            return SkopState.__default.Yes((s).dtor_vars, (_0_t).dtor_gov);
          }
        }
        {
          if (_source0.is_IfYesDo) {
            return (SkopState.__default.Yes((s).dtor_vars, (_0_t).dtor_gov)) && (!(((s).dtor_cfg).dtor_dry));
          }
        }
        {
          if (_source0.is_Page) {
            return !(((s).dtor_cfg).dtor_dry);
          }
        }
        {
          return false;
        }
      }());
    };
    static DoReady(vars, a) {
      return !((a).is_DoItem) || (((((vars).contains((a).dtor_item)) && ((((vars).get((a).dtor_item)).dtor_item).is_Some)) && (((((vars).get((a).dtor_item)).dtor_item).dtor_value).is_Action)) && (SkopState.__default.CmdBound(vars, ((((vars).get((a).dtor_item)).dtor_item).dtor_value).dtor_cmd)));
    };
    static DoParts(vars, a) {
      let _source0 = a;
      {
        if (_source0.is_DoCmd) {
          let _0_c = (_source0).cmd;
          return _0_c;
        }
      }
      {
        let _1_x = (_source0).item;
        return ((((vars).get(_1_x)).dtor_item).dtor_value).dtor_cmd;
      }
    };
    static ExecOf(vars, c, kind, timeoutMs, src) {
      return SkopStep.Next.create_Exec(SkopState.__default.RenderCmd(vars, c), kind, timeoutMs, src);
    };
    static IssueNext(s) {
      let _0_p = (s).dtor_prog;
      let _1_st = ((((s).dtor_tasks)[_dafny.ZERO]).dtor_op).dtor_stmt;
      let _source0 = _1_st;
      {
        if (_source0.is_Run) {
          let _2_src = (_source0).src;
          let _3_c = (_source0).cmd;
          return SkopState.__default.ExecOf((s).dtor_vars, _3_c, SkopStep.ExecKind.create_RunExec(), ((_0_p).dtor_limits).dtor_runTimeoutMs, _2_src);
        }
      }
      {
        if (_source0.is_Do) {
          let _4_src = (_source0).src;
          let _5_a = (_source0).action;
          return SkopState.__default.ExecOf((s).dtor_vars, SkopState.__default.DoParts((s).dtor_vars, _5_a), SkopStep.ExecKind.create_DoExec(), ((_0_p).dtor_limits).dtor_doTimeoutMs, _4_src);
        }
      }
      {
        if (_source0.is_Check) {
          let _6_src = (_source0).src;
          let _7_cond = (_source0).cond;
          if ((_7_cond).is_Succeeds) {
            return SkopState.__default.ExecOf((s).dtor_vars, (_7_cond).dtor_cmd, SkopStep.ExecKind.create_CheckExec(), ((_0_p).dtor_limits).dtor_runTimeoutMs, _6_src);
          } else {
            return SkopStep.Next.create_Choose(new BigNumber(3));
          }
        }
      }
      {
        if (_source0.is_Ask) {
          let _8_src = (_source0).src;
          let _9_q = (_source0).question;
          let _10_form = (_source0).form;
          return SkopStep.Next.create_AskNext(SkopState.__default.AskReq(_0_p, (s).dtor_sec, (s).dtor_vars, (s).dtor_runNames, _9_q, _10_form), _8_src);
        }
      }
      {
        if (_source0.is_IfYesRun) {
          let _11_src = (_source0).src;
          let _12_c = (_source0).cmd;
          return SkopState.__default.ExecOf((s).dtor_vars, _12_c, SkopStep.ExecKind.create_RunExec(), ((_0_p).dtor_limits).dtor_runTimeoutMs, _11_src);
        }
      }
      {
        if (_source0.is_IfYesDo) {
          let _13_src = (_source0).src;
          let _14_a = (_source0).action;
          return SkopState.__default.ExecOf((s).dtor_vars, SkopState.__default.DoParts((s).dtor_vars, _14_a), SkopStep.ExecKind.create_DoExec(), ((_0_p).dtor_limits).dtor_doTimeoutMs, _13_src);
        }
      }
      {
        if (_source0.is_Page) {
          let _15_src = (_source0).src;
          let _16_text = (_source0).text;
          return SkopStep.Next.create_PageNext(SkopState.__default.RenderText((s).dtor_vars, _16_text), _15_src);
        }
      }
      {
        return SkopStep.Next.create_Choose(_dafny.ZERO);
      }
    };
    static TemplateOf(st, kind) {
      let _source0 = st;
      {
        if (_source0.is_Run) {
          let _0_c = (_source0).cmd;
          if (_dafny.areEqual(kind, SkopStep.ExecKind.create_RunExec())) {
            return SkopAst.Option.create_Some(_0_c);
          } else {
            return SkopAst.Option.create_None();
          }
        }
      }
      {
        if (_source0.is_IfYesRun) {
          let _1_c = (_source0).cmd;
          if (_dafny.areEqual(kind, SkopStep.ExecKind.create_RunExec())) {
            return SkopAst.Option.create_Some(_1_c);
          } else {
            return SkopAst.Option.create_None();
          }
        }
      }
      {
        if (_source0.is_Check) {
          let cond0 = (_source0).cond;
          if (cond0.is_Succeeds) {
            let _2_c = (cond0).cmd;
            if (_dafny.areEqual(kind, SkopStep.ExecKind.create_CheckExec())) {
              return SkopAst.Option.create_Some(_2_c);
            } else {
              return SkopAst.Option.create_None();
            }
          }
        }
      }
      {
        if (_source0.is_Do) {
          let action0 = (_source0).action;
          if (action0.is_DoCmd) {
            let _3_c = (action0).cmd;
            if (_dafny.areEqual(kind, SkopStep.ExecKind.create_DoExec())) {
              return SkopAst.Option.create_Some(_3_c);
            } else {
              return SkopAst.Option.create_None();
            }
          }
        }
      }
      {
        if (_source0.is_IfYesDo) {
          let action1 = (_source0).action;
          if (action1.is_DoCmd) {
            let _4_c = (action1).cmd;
            if (_dafny.areEqual(kind, SkopStep.ExecKind.create_DoExec())) {
              return SkopAst.Option.create_Some(_4_c);
            } else {
              return SkopAst.Option.create_None();
            }
          }
        }
      }
      {
        return SkopAst.Option.create_None();
      }
    };
    static InitVars(cfg) {
      return (function () {
        let _coll0 = new _dafny.Map();
        for (const _compr_0 of ((cfg).dtor_builtins).Keys.Elements) {
          let _0_x = _compr_0;
          if (((cfg).dtor_builtins).contains(_0_x)) {
            _coll0.push([_0_x,SkopState.Slot.create_Slot(SkopStep.Bound.create_Bound(((cfg).dtor_builtins).get(_0_x), SkopStep.Origin.create_FromBuiltin()), SkopAst.Option.create_None())]);
          }
        }
        return _coll0;
      }()).Merge(function () {
        let _coll1 = new _dafny.Map();
        for (const _compr_1 of ((cfg).dtor_params).Keys.Elements) {
          let _1_x = _compr_1;
          if (((cfg).dtor_params).contains(_1_x)) {
            _coll1.push([_1_x,SkopState.Slot.create_Slot(SkopStep.Bound.create_Bound(((cfg).dtor_params).get(_1_x), SkopStep.Origin.create_FromParam()), SkopAst.Option.create_None())]);
          }
        }
        return _coll1;
      }());
    };
    static StartState(p, cfg) {
      return SkopState.State.create_State(p, cfg, ((p).dtor_entry).dtor_section, SkopState.__default.Tasks(p, SkopWellFormed.__default.Body(p, ((p).dtor_entry).dtor_section), SkopAst.Option.create_None()), SkopState.__default.InitVars(cfg), SkopState.__default.RunNames(p), SkopAst.Option.create_None(), false, _dafny.ZERO, _dafny.ZERO);
    };
    static Enter(s, id, e) {
      let _0_dt__update__tmp_h0 = s;
      let _1_dt__update_hvars_h0 = ((s).dtor_vars).Subtract(SkopState.__default.LoopVars((s).dtor_tasks));
      let _2_dt__update_htasks_h0 = SkopState.__default.Tasks((s).dtor_prog, SkopWellFormed.__default.Body((s).dtor_prog, id), SkopAst.Option.create_None());
      let _3_dt__update_hsec_h0 = id;
      return SkopState.State.create_State((_0_dt__update__tmp_h0).dtor_prog, (_0_dt__update__tmp_h0).dtor_cfg, _3_dt__update_hsec_h0, _2_dt__update_htasks_h0, _1_dt__update_hvars_h0, (_0_dt__update__tmp_h0).dtor_runNames, (_0_dt__update__tmp_h0).dtor_last, (_0_dt__update__tmp_h0).dtor_afterWouldDo, (_0_dt__update__tmp_h0).dtor_askCalls, (_0_dt__update__tmp_h0).dtor_effects);
    };
    static Stmt0(s) {
      return ((((s).dtor_tasks)[_dafny.ZERO]).dtor_op).dtor_stmt;
    };
    static get Unavailable() {
      return _dafny.Seq.UnicodeFromString("(unavailable)");
    };
  };

  $module.Slot = class Slot {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Slot(b, item) {
      let $dt = new Slot(0);
      $dt.b = b;
      $dt.item = item;
      return $dt;
    }
    get is_Slot() { return this.$tag === 0; }
    get dtor_b() { return this.b; }
    get dtor_item() { return this.item; }
    toString() {
      if (this.$tag === 0) {
        return "SkopState.Slot.Slot" + "(" + _dafny.toString(this.b) + ", " + _dafny.toString(this.item) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.b, other.b) && _dafny.areEqual(this.item, other.item);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopState.Slot.create_Slot(SkopStep.Bound.Default(), SkopAst.Option.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Slot.Default();
        }
      };
    }
  }

  $module.Op = class Op {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_S(stmt) {
      let $dt = new Op(0);
      $dt.stmt = stmt;
      return $dt;
    }
    static create_Bind(v, item, src) {
      let $dt = new Op(1);
      $dt.v = v;
      $dt.item = item;
      $dt.src = src;
      return $dt;
    }
    static create_Unbind(v, src) {
      let $dt = new Op(2);
      $dt.v = v;
      $dt.src = src;
      return $dt;
    }
    get is_S() { return this.$tag === 0; }
    get is_Bind() { return this.$tag === 1; }
    get is_Unbind() { return this.$tag === 2; }
    get dtor_stmt() { return this.stmt; }
    get dtor_v() { return this.v; }
    get dtor_item() { return this.item; }
    get dtor_src() { return this.src; }
    toString() {
      if (this.$tag === 0) {
        return "SkopState.Op.S" + "(" + _dafny.toString(this.stmt) + ")";
      } else if (this.$tag === 1) {
        return "SkopState.Op.Bind" + "(" + this.v.toVerbatimString(true) + ", " + _dafny.toString(this.item) + ", " + _dafny.toString(this.src) + ")";
      } else if (this.$tag === 2) {
        return "SkopState.Op.Unbind" + "(" + this.v.toVerbatimString(true) + ", " + _dafny.toString(this.src) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.stmt, other.stmt);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.v, other.v) && _dafny.areEqual(this.item, other.item) && _dafny.areEqual(this.src, other.src);
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.v, other.v) && _dafny.areEqual(this.src, other.src);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopState.Op.create_S(SkopAst.Stmt.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Op.Default();
        }
      };
    }
  }

  $module.Task = class Task {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Task(op, gov) {
      let $dt = new Task(0);
      $dt.op = op;
      $dt.gov = gov;
      return $dt;
    }
    get is_Task() { return this.$tag === 0; }
    get dtor_op() { return this.op; }
    get dtor_gov() { return this.gov; }
    toString() {
      if (this.$tag === 0) {
        return "SkopState.Task.Task" + "(" + _dafny.toString(this.op) + ", " + _dafny.toString(this.gov) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.op, other.op) && _dafny.areEqual(this.gov, other.gov);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopState.Task.create_Task(SkopState.Op.Default(), SkopAst.Option.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Task.Default();
        }
      };
    }
  }

  $module.State = class State {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_State(prog, cfg, sec, tasks, vars, runNames, last, afterWouldDo, askCalls, effects) {
      let $dt = new State(0);
      $dt.prog = prog;
      $dt.cfg = cfg;
      $dt.sec = sec;
      $dt.tasks = tasks;
      $dt.vars = vars;
      $dt.runNames = runNames;
      $dt.last = last;
      $dt.afterWouldDo = afterWouldDo;
      $dt.askCalls = askCalls;
      $dt.effects = effects;
      return $dt;
    }
    get is_State() { return this.$tag === 0; }
    get dtor_prog() { return this.prog; }
    get dtor_cfg() { return this.cfg; }
    get dtor_sec() { return this.sec; }
    get dtor_tasks() { return this.tasks; }
    get dtor_vars() { return this.vars; }
    get dtor_runNames() { return this.runNames; }
    get dtor_last() { return this.last; }
    get dtor_afterWouldDo() { return this.afterWouldDo; }
    get dtor_askCalls() { return this.askCalls; }
    get dtor_effects() { return this.effects; }
    toString() {
      if (this.$tag === 0) {
        return "SkopState.State.State" + "(" + _dafny.toString(this.prog) + ", " + _dafny.toString(this.cfg) + ", " + this.sec.toVerbatimString(true) + ", " + _dafny.toString(this.tasks) + ", " + _dafny.toString(this.vars) + ", " + _dafny.toString(this.runNames) + ", " + _dafny.toString(this.last) + ", " + _dafny.toString(this.afterWouldDo) + ", " + _dafny.toString(this.askCalls) + ", " + _dafny.toString(this.effects) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.prog, other.prog) && _dafny.areEqual(this.cfg, other.cfg) && _dafny.areEqual(this.sec, other.sec) && _dafny.areEqual(this.tasks, other.tasks) && _dafny.areEqual(this.vars, other.vars) && _dafny.areEqual(this.runNames, other.runNames) && _dafny.areEqual(this.last, other.last) && this.afterWouldDo === other.afterWouldDo && _dafny.areEqual(this.askCalls, other.askCalls) && _dafny.areEqual(this.effects, other.effects);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopState.State.create_State(SkopAst.Program.Default(), SkopStep.RunConfig.Default(), _dafny.Seq.UnicodeFromString(""), _dafny.Seq.of(), _dafny.Map.Empty, _dafny.Set.Empty, SkopAst.Option.Default(), false, _dafny.ZERO, _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return State.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module SkopState
let SkopLemmas = (function() {
  let $module = {};

  return $module;
})(); // end of module SkopLemmas
let SkopRun = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "SkopRun._default";
    }
    _parentTraits() {
      return [];
    }
    static Start(p, cfg) {
      return SkopState.__default.StartState(p, cfg);
    };
    static Ev(s, body) {
      return SkopStep.CoreEvent.create_CoreEvent(SkopAst.Option.create_Some(SkopStep.Where.create_Where(((((s).dtor_prog).dtor_sections).get((s).dtor_sec)).dtor_name, SkopState.__default.OpSrc((((s).dtor_tasks)[_dafny.ZERO]).dtor_op))), body);
    };
    static Log(s, e) {
      let _0_dt__update__tmp_h2 = s;
      return SkopState.State.create_State((_0_dt__update__tmp_h2).dtor_prog, (_0_dt__update__tmp_h2).dtor_cfg, (_0_dt__update__tmp_h2).dtor_sec, (_0_dt__update__tmp_h2).dtor_tasks, (_0_dt__update__tmp_h2).dtor_vars, (_0_dt__update__tmp_h2).dtor_runNames, (_0_dt__update__tmp_h2).dtor_last, (_0_dt__update__tmp_h2).dtor_afterWouldDo, (_0_dt__update__tmp_h2).dtor_askCalls, (_0_dt__update__tmp_h2).dtor_effects);
    };
    static Then(e, r) {
      return _dafny.Tuple.of((r)[0], _dafny.Seq.Concat(_dafny.Seq.of(e), (r)[1]), (r)[2]);
    };
    static Finish(s, o) {
      let _pat_let_tv0 = o;
      let _0_e = SkopRun.__default.Ev(s, SkopStep.EventBody.create_OutcomeEv(o, (s).dtor_askCalls, (s).dtor_effects, ((s).dtor_cfg).dtor_dry));
      return _dafny.Tuple.of(function (_pat_let5_0) {
  return function (_1_dt__update__tmp_h1) {
    return function (_pat_let6_0) {
      return function (_2_dt__update_hlast_h1) {
        return SkopState.State.create_State((_1_dt__update__tmp_h1).dtor_prog, (_1_dt__update__tmp_h1).dtor_cfg, (_1_dt__update__tmp_h1).dtor_sec, (_1_dt__update__tmp_h1).dtor_tasks, (_1_dt__update__tmp_h1).dtor_vars, (_1_dt__update__tmp_h1).dtor_runNames, _2_dt__update_hlast_h1, (_1_dt__update__tmp_h1).dtor_afterWouldDo, (_1_dt__update__tmp_h1).dtor_askCalls, (_1_dt__update__tmp_h1).dtor_effects);
      }(_pat_let6_0);
    }(SkopAst.Option.create_Some(SkopStep.Next.create_Done(_pat_let_tv0)));
  }(_pat_let5_0);
}(s), _dafny.Seq.of(_0_e), SkopStep.Next.create_Done(o));
    };
    static Continue(s, vars2) {
      let _pat_let_tv0 = vars2;
      let _pat_let_tv1 = s;
      return SkopRun.__default.Advance(function (_pat_let7_0) {
        return function (_0_dt__update__tmp_h0) {
          return function (_pat_let8_0) {
            return function (_1_dt__update_hvars_h0) {
              return function (_pat_let9_0) {
                return function (_2_dt__update_htasks_h0) {
                  return SkopState.State.create_State((_0_dt__update__tmp_h0).dtor_prog, (_0_dt__update__tmp_h0).dtor_cfg, (_0_dt__update__tmp_h0).dtor_sec, _2_dt__update_htasks_h0, _1_dt__update_hvars_h0, (_0_dt__update__tmp_h0).dtor_runNames, (_0_dt__update__tmp_h0).dtor_last, (_0_dt__update__tmp_h0).dtor_afterWouldDo, (_0_dt__update__tmp_h0).dtor_askCalls, (_0_dt__update__tmp_h0).dtor_effects);
                }(_pat_let9_0);
              }(((_pat_let_tv1).dtor_tasks).slice(_dafny.ONE));
            }(_pat_let8_0);
          }(_pat_let_tv0);
        }(_pat_let7_0);
      }(s));
    };
    static Goto(s, j) {
      let _0_p = (s).dtor_prog;
      let _1_id = ((j).dtor_ref).dtor_id;
      let _2_e = SkopRun.__default.Ev(s, SkopStep.EventBody.create_TransferEv((((_0_p).dtor_sections).get((s).dtor_sec)).dtor_name, (((_0_p).dtor_sections).get(_1_id)).dtor_name));
      return SkopRun.__default.Then(_2_e, SkopRun.__default.Advance(SkopState.__default.Enter(s, _1_id, _2_e)));
    };
    static Advance(s) {
      let _pat_let_tv0 = s;
      let _0_p = (s).dtor_prog;
      let _1_t = ((s).dtor_tasks)[_dafny.ZERO];
      let _source0 = (_1_t).dtor_op;
      {
        if (_source0.is_Bind) {
          let _2_v = (_source0).v;
          let _3_it = (_source0).item;
          return SkopRun.__default.Continue(s, ((s).dtor_vars).update(_2_v, SkopState.__default.ItemSlot(_3_it)));
        }
      }
      {
        if (_source0.is_Unbind) {
          let _4_v = (_source0).v;
          return SkopRun.__default.Continue(s, ((s).dtor_vars).Subtract(_dafny.Set.fromElements(_4_v)));
        }
      }
      {
        let _5_st = (_source0).stmt;
        if (SkopState.__default.Issues(s)) {
          return SkopRun.__default.Issue(s);
        } else {
          let _source1 = _5_st;
          {
            if (_source1.is_Stop) {
              return SkopRun.__default.Finish(s, SkopStep.Outcome.create_Stopped());
            }
          }
          {
            if (_source1.is_HandOff) {
              return SkopRun.__default.Finish(s, SkopStep.Outcome.create_Handoff(SkopStep.Reason.create_Explicit(), SkopAst.Option.create_None()));
            }
          }
          {
            if (_source1.is_Then) {
              let _6_src = (_source1).src;
              let _7_r = (_source1).ref;
              return SkopRun.__default.Goto(s, SkopWellFormed.Jump.create_Jump(_7_r, _6_src));
            }
          }
          {
            if (_source1.is_ForEach) {
              return SkopRun.__default.Advance(function (_pat_let10_0) {
                return function (_8_dt__update__tmp_h0) {
                  return function (_pat_let11_0) {
                    return function (_9_dt__update_htasks_h0) {
                      return SkopState.State.create_State((_8_dt__update__tmp_h0).dtor_prog, (_8_dt__update__tmp_h0).dtor_cfg, (_8_dt__update__tmp_h0).dtor_sec, _9_dt__update_htasks_h0, (_8_dt__update__tmp_h0).dtor_vars, (_8_dt__update__tmp_h0).dtor_runNames, (_8_dt__update__tmp_h0).dtor_last, (_8_dt__update__tmp_h0).dtor_afterWouldDo, (_8_dt__update__tmp_h0).dtor_askCalls, (_8_dt__update__tmp_h0).dtor_effects);
                    }(_pat_let11_0);
                  }(_dafny.Seq.Concat(SkopState.__default.Expand(_0_p, _1_t), ((_pat_let_tv0).dtor_tasks).slice(_dafny.ONE)));
                }(_pat_let10_0);
              }(s));
            }
          }
          {
            if (_source1.is_Page) {
              let _10_text = (_source1).text;
              let _11_e = SkopRun.__default.Ev(s, SkopStep.EventBody.create_WouldPageEv(SkopState.__default.RenderText((s).dtor_vars, _10_text)));
              return SkopRun.__default.Then(_11_e, SkopRun.__default.Finish(SkopRun.__default.Log(s, _11_e), SkopStep.Outcome.create_Paged()));
            }
          }
          {
            if (_source1.is_Do) {
              let _12_a = (_source1).action;
              return SkopRun.__default.WouldDo(s, _12_a);
            }
          }
          {
            if (_source1.is_IfYesDo) {
              let _13_a = (_source1).action;
              if (SkopState.__default.Yes((s).dtor_vars, (_1_t).dtor_gov)) {
                return SkopRun.__default.WouldDo(s, _13_a);
              } else {
                return SkopRun.__default.Continue(s, (s).dtor_vars);
              }
            }
          }
          {
            if (_source1.is_IfYesRun) {
              return SkopRun.__default.Continue(s, (s).dtor_vars);
            }
          }
          {
            if (_source1.is_Check) {
              let _14_cond = (_source1).cond;
              return SkopRun.__default.Compare(s, _14_cond);
            }
          }
          {
            return SkopRun.__default.Finish(s, SkopStep.Outcome.create_Stopped());
          }
        }
      }
    };
    static Issue(s) {
      let _pat_let_tv0 = s;
      let _0_n = SkopState.__default.IssueNext(s);
      if (((SkopState.__default.Stmt0(s)).is_Do) || ((SkopState.__default.Stmt0(s)).is_IfYesDo)) {
        let _1_e = SkopRun.__default.Ev(s, SkopStep.EventBody.create_EffectStartEv((_0_n).dtor_cmd));
        return _dafny.Tuple.of(function (_pat_let12_0) {
  return function (_2_dt__update__tmp_h1) {
    return function (_pat_let13_0) {
      return function (_3_dt__update_hlast_h1) {
        return function (_pat_let14_0) {
          return function (_4_dt__update_heffects_h1) {
            return SkopState.State.create_State((_2_dt__update__tmp_h1).dtor_prog, (_2_dt__update__tmp_h1).dtor_cfg, (_2_dt__update__tmp_h1).dtor_sec, (_2_dt__update__tmp_h1).dtor_tasks, (_2_dt__update__tmp_h1).dtor_vars, (_2_dt__update__tmp_h1).dtor_runNames, _3_dt__update_hlast_h1, (_2_dt__update__tmp_h1).dtor_afterWouldDo, (_2_dt__update__tmp_h1).dtor_askCalls, _4_dt__update_heffects_h1);
          }(_pat_let14_0);
        }(((_pat_let_tv0).dtor_effects).plus(_dafny.ONE));
      }(_pat_let13_0);
    }(SkopAst.Option.create_Some(_0_n));
  }(_pat_let12_0);
}(s), _dafny.Seq.of(_1_e), _0_n);
      } else {
        return _dafny.Tuple.of(function (_pat_let15_0) {
  return function (_5_dt__update__tmp_h3) {
    return function (_pat_let16_0) {
      return function (_6_dt__update_hlast_h3) {
        return SkopState.State.create_State((_5_dt__update__tmp_h3).dtor_prog, (_5_dt__update__tmp_h3).dtor_cfg, (_5_dt__update__tmp_h3).dtor_sec, (_5_dt__update__tmp_h3).dtor_tasks, (_5_dt__update__tmp_h3).dtor_vars, (_5_dt__update__tmp_h3).dtor_runNames, _6_dt__update_hlast_h3, (_5_dt__update__tmp_h3).dtor_afterWouldDo, (_5_dt__update__tmp_h3).dtor_askCalls, (_5_dt__update__tmp_h3).dtor_effects);
      }(_pat_let16_0);
    }(SkopAst.Option.create_Some(_0_n));
  }(_pat_let15_0);
}(s), _dafny.Seq.of(), _0_n);
      }
    };
    static WouldDo(s, a) {
      let _pat_let_tv0 = s;
      let _0_e = SkopRun.__default.Ev(s, SkopStep.EventBody.create_WouldDoEv(SkopState.__default.RenderCmd((s).dtor_vars, SkopState.__default.DoParts((s).dtor_vars, a))));
      let _1_s1 = function (_pat_let17_0) {
        return function (_2_dt__update__tmp_h0) {
          return function (_pat_let18_0) {
            return function (_3_dt__update_heffects_h0) {
              return function (_pat_let19_0) {
                return function (_4_dt__update_hafterWouldDo_h0) {
                  return SkopState.State.create_State((_2_dt__update__tmp_h0).dtor_prog, (_2_dt__update__tmp_h0).dtor_cfg, (_2_dt__update__tmp_h0).dtor_sec, (_2_dt__update__tmp_h0).dtor_tasks, (_2_dt__update__tmp_h0).dtor_vars, (_2_dt__update__tmp_h0).dtor_runNames, (_2_dt__update__tmp_h0).dtor_last, _4_dt__update_hafterWouldDo_h0, (_2_dt__update__tmp_h0).dtor_askCalls, _3_dt__update_heffects_h0);
                }(_pat_let19_0);
              }(true);
            }(_pat_let18_0);
          }(((_pat_let_tv0).dtor_effects).plus(_dafny.ONE));
        }(_pat_let17_0);
      }(s);
      return SkopRun.__default.Then(_0_e, SkopRun.__default.Continue(_1_s1, (s).dtor_vars));
    };
    static OperandVal(vars, o) {
      let _source0 = o;
      {
        if (_source0.is_VarOp) {
          let _0_x = (_source0).name;
          return (((vars).get(_0_x)).dtor_b).dtor_value;
        }
      }
      {
        let _1_t = (_source0).text;
        return SkopStep.Val.create_Str(_1_t);
      }
    };
    static OperandText(o) {
      let _source0 = o;
      {
        if (_source0.is_VarOp) {
          let _0_x = (_source0).name;
          return _dafny.Seq.Concat(_dafny.Seq.Concat(_dafny.Seq.UnicodeFromString("{"), _0_x), _dafny.Seq.UnicodeFromString("}"));
        }
      }
      {
        let _1_t = (_source0).text;
        return _1_t;
      }
    };
    static OpText(op) {
      let _source0 = op;
      {
        if (_source0.is_Lt) {
          return _dafny.Seq.UnicodeFromString("<");
        }
      }
      {
        if (_source0.is_Le) {
          return _dafny.Seq.UnicodeFromString("<=");
        }
      }
      {
        if (_source0.is_Gt) {
          return _dafny.Seq.UnicodeFromString(">");
        }
      }
      {
        if (_source0.is_Ge) {
          return _dafny.Seq.UnicodeFromString(">=");
        }
      }
      {
        if (_source0.is_Eq) {
          return _dafny.Seq.UnicodeFromString("==");
        }
      }
      {
        return _dafny.Seq.UnicodeFromString("!=");
      }
    };
    static Expr(c) {
      return _dafny.Seq.Concat(_dafny.Seq.Concat(_dafny.Seq.Concat(_dafny.Seq.Concat(SkopRun.__default.OperandText((c).dtor_l), _dafny.Seq.UnicodeFromString(" ")), SkopRun.__default.OpText((c).dtor_op)), _dafny.Seq.UnicodeFromString(" ")), SkopRun.__default.OperandText((c).dtor_r));
    };
    static Compare(s, c) {
      let _0_l = SkopRun.__default.OperandVal((s).dtor_vars, (c).dtor_l);
      let _1_r = SkopRun.__default.OperandVal((s).dtor_vars, (c).dtor_r);
      let _2_a = SkopValues.__default.Coerce(_0_l);
      let _3_b = SkopValues.__default.Coerce(_1_r);
      let _4_result = ((((_2_a).is_Some) && ((_3_b).is_Some)) ? (SkopAst.Option.create_Some(SkopValues.__default.Compare((c).dtor_op, (_2_a).dtor_value, (_3_b).dtor_value))) : (SkopAst.Option.create_None()));
      let _5_e = SkopRun.__default.Ev(s, SkopStep.EventBody.create_CheckEv(SkopRun.__default.Expr(c), SkopValues.__default.NumText(_0_l), SkopValues.__default.NumText(_1_r), _4_result, (s).dtor_afterWouldDo));
      return SkopRun.__default.Then(_5_e, (((_4_result).is_None) ? (SkopRun.__default.Failed(SkopRun.__default.Log(s, _5_e))) : (SkopRun.__default.CheckDone(SkopRun.__default.Log(s, _5_e), (_4_result).dtor_value))));
    };
    static Failed(s) {
      let _0_st = SkopState.__default.Stmt0(s);
      let _source0 = (_0_st).dtor_els;
      {
        if (_source0.is_NoElse) {
          return SkopRun.__default.Finish(s, SkopStep.Outcome.create_Handoff(SkopStep.Reason.create_CommandFailed(), SkopAst.Option.create_None()));
        }
      }
      {
        if (_source0.is_Skip) {
          if (((_0_st).is_Run) && (((_0_st).dtor_binding).is_Some)) {
            return SkopRun.__default.Continue(s, ((s).dtor_vars).Subtract(_dafny.Set.fromElements(((_0_st).dtor_binding).dtor_value)));
          } else {
            return SkopRun.__default.Continue(s, (s).dtor_vars);
          }
        }
      }
      {
        let _1_r = (_source0).ref;
        return SkopRun.__default.Goto(s, SkopWellFormed.Jump.create_Jump(_1_r, (_0_st).dtor_src));
      }
    };
    static CheckDone(s, b) {
      let _0_st = SkopState.__default.Stmt0(s);
      if (b) {
        let _source0 = (_0_st).dtor_onTrue;
        {
          if (_source0.is_None) {
            return SkopRun.__default.Continue(s, (s).dtor_vars);
          }
        }
        {
          if (_source0.is_Some) {
            let value0 = (_source0).value;
            if (value0.is_StopTarget) {
              return SkopRun.__default.Finish(s, SkopStep.Outcome.create_Stopped());
            }
          }
        }
        {
          let value1 = (_source0).value;
          let _1_r = (value1).ref;
          return SkopRun.__default.Goto(s, SkopWellFormed.Jump.create_Jump(_1_r, (_0_st).dtor_src));
        }
      } else if (((_0_st).dtor_els).is_ElseTo) {
        return SkopRun.__default.Goto(s, SkopWellFormed.Jump.create_Jump(((_0_st).dtor_els).dtor_ref, (_0_st).dtor_src));
      } else {
        return SkopRun.__default.Continue(s, (s).dtor_vars);
      }
    };
    static Ok(r) {
      return (_dafny.areEqual((r).dtor_exit, SkopAst.Option.create_Some(_dafny.ZERO))) && (!((r).dtor_timedOut));
    };
    static RunSlot(stdout) {
      return SkopState.Slot.create_Slot(SkopStep.Bound.create_Bound(SkopStep.Val.create_Str(SkopValues.__default.Trim(stdout)), SkopStep.Origin.create_FromRunOutput()), SkopAst.Option.create_None());
    };
    static Range(form) {
      if ((form).is_Score) {
        return SkopAst.Option.create_Some(_dafny.Tuple.of((form).dtor_low, (form).dtor_high));
      } else {
        return SkopAst.Option.create_None();
      }
    };
    static ChosenOf(form, ids, c) {
      if ((form).is_Score) {
        return SkopStep.Chosen.create_ChosenLevel(((form).dtor_low).plus(c));
      } else {
        return SkopStep.Chosen.create_ChosenId((ids)[c]);
      }
    };
    static FailureText(f) {
      let _source0 = f;
      {
        if (_source0.is_Unavailable) {
          return _dafny.Seq.UnicodeFromString("unavailable");
        }
      }
      {
        return _dafny.Seq.UnicodeFromString("request_too_large");
      }
    };
    static GateMiss(s) {
      let _0_st = SkopState.__default.Stmt0(s);
      let _source0 = (_0_st).dtor_els;
      {
        if (_source0.is_NoElse) {
          return SkopRun.__default.Finish(s, SkopStep.Outcome.create_Handoff(SkopStep.Reason.create_GateFailed(), SkopAst.Option.create_None()));
        }
      }
      {
        if (_source0.is_Skip) {
          let _1_sl = SkopState.Slot.create_Slot(SkopStep.Bound.create_Bound(SkopStep.Val.create_Str(_dafny.Seq.UnicodeFromString("no")), SkopStep.Origin.create_FromYesNo()), SkopAst.Option.create_None());
          return SkopRun.__default.Continue(s, ((s).dtor_vars).update(((_0_st).dtor_form).dtor_binding, _1_sl));
        }
      }
      {
        let _2_r = (_source0).ref;
        return SkopRun.__default.Goto(s, SkopWellFormed.Jump.create_Jump(_2_r, (_0_st).dtor_src));
      }
    };
    static Accept(s, c) {
      let _0_st = SkopState.__default.Stmt0(s);
      let _1_p = (s).dtor_prog;
      let _source0 = (_0_st).dtor_form;
      {
        if (_source0.is_Sections) {
          let _2_opts = (_source0).options;
          return SkopRun.__default.Goto(s, SkopWellFormed.Jump.create_Jump(((_2_opts)[c]).dtor_ref, ((_2_opts)[c]).dtor_src));
        }
      }
      {
        if (_source0.is_YesNo) {
          let _3_x = (_source0).binding;
          let _4_sl = SkopState.Slot.create_Slot(SkopStep.Bound.create_Bound(SkopStep.Val.create_Str((((c).isEqualTo(_dafny.ZERO)) ? (_dafny.Seq.UnicodeFromString("yes")) : (_dafny.Seq.UnicodeFromString("no")))), SkopStep.Origin.create_FromYesNo()), SkopAst.Option.create_None());
          return SkopRun.__default.Continue(s, ((s).dtor_vars).update(_3_x, _4_sl));
        }
      }
      {
        if (_source0.is_OneOf) {
          let _5_l = (_source0).list;
          let _6_x = (_source0).binding;
          let _7_it = ((SkopWellFormed.__default.DataList(_1_p, (_5_l).dtor_id)).dtor_items)[c];
          let _8_sl = SkopState.Slot.create_Slot(SkopStep.Bound.create_Bound(SkopStep.Val.create_Str((_7_it).dtor_value), SkopStep.Origin.create_FromListItem()), SkopAst.Option.create_None());
          return SkopRun.__default.Continue(s, ((s).dtor_vars).update(_6_x, _8_sl));
        }
      }
      {
        let _9_lo = (_source0).low;
        let _10_x = (_source0).binding;
        let _11_sl = SkopState.Slot.create_Slot(SkopStep.Bound.create_Bound(SkopStep.Val.create_Int((_9_lo).plus(c)), SkopStep.Origin.create_FromScore()), SkopAst.Option.create_None());
        return SkopRun.__default.Continue(s, ((s).dtor_vars).update(_10_x, _11_sl));
      }
    };
    static Answered(s, st, req, r) {
      let _0_ids = SkopValues.__default.Ids((req).dtor_options);
      let _1_v = SkopValues.__default.Gate(_0_ids, (r).dtor_probs, (r).dtor_unassigned, (st).dtor_sure);
      let _source0 = _1_v;
      {
        if (_source0.is_Invalid) {
          let _2_e = SkopRun.__default.Ev(s, SkopStep.EventBody.create_AskEv((req).dtor_question, (req).dtor_kind, SkopAst.Option.create_None(), SkopAst.Option.create_None(), SkopAst.Option.create_None(), (st).dtor_sure, false, SkopRun.__default.Range((st).dtor_form), SkopAst.Option.create_Some(SkopStep.AskFailure.create_Unavailable()), (s).dtor_afterWouldDo));
          return SkopRun.__default.Then(_2_e, SkopRun.__default.Finish(SkopRun.__default.Log(s, _2_e), SkopStep.Outcome.create_Handoff(SkopStep.Reason.create_AskUnavailable(), SkopAst.Option.create_Some(SkopRun.__default.FailureText(SkopStep.AskFailure.create_Unavailable())))));
        }
      }
      {
        if (_source0.is_Unsure) {
          let _3_c = (_source0).chosen;
          let _4_conf = (_source0).conf;
          let _5_e = SkopRun.__default.Ev(s, SkopStep.EventBody.create_AskEv((req).dtor_question, (req).dtor_kind, SkopAst.Option.create_Some((r).dtor_probs), SkopAst.Option.create_Some(SkopRun.__default.ChosenOf((st).dtor_form, _0_ids, _3_c)), SkopAst.Option.create_Some(_4_conf), (st).dtor_sure, false, SkopRun.__default.Range((st).dtor_form), SkopAst.Option.create_None(), (s).dtor_afterWouldDo));
          return SkopRun.__default.Then(_5_e, SkopRun.__default.GateMiss(SkopRun.__default.Log(s, _5_e)));
        }
      }
      {
        let _6_c = (_source0).chosen;
        let _7_conf = (_source0).conf;
        let _8_e = SkopRun.__default.Ev(s, SkopStep.EventBody.create_AskEv((req).dtor_question, (req).dtor_kind, SkopAst.Option.create_Some((r).dtor_probs), SkopAst.Option.create_Some(SkopRun.__default.ChosenOf((st).dtor_form, _0_ids, _6_c)), SkopAst.Option.create_Some(_7_conf), (st).dtor_sure, true, SkopRun.__default.Range((st).dtor_form), SkopAst.Option.create_None(), (s).dtor_afterWouldDo));
        return SkopRun.__default.Then(_8_e, SkopRun.__default.Accept(SkopRun.__default.Log(s, _8_e), _6_c));
      }
    };
    static Resume(s, r) {
      let _0_n = ((s).dtor_last).dtor_value;
      let _1_st = SkopState.__default.Stmt0(s);
      let _2_s0 = function (_pat_let20_0) {
        return function (_3_dt__update__tmp_h0) {
          return function (_pat_let21_0) {
            return function (_4_dt__update_hlast_h0) {
              return SkopState.State.create_State((_3_dt__update__tmp_h0).dtor_prog, (_3_dt__update__tmp_h0).dtor_cfg, (_3_dt__update__tmp_h0).dtor_sec, (_3_dt__update__tmp_h0).dtor_tasks, (_3_dt__update__tmp_h0).dtor_vars, (_3_dt__update__tmp_h0).dtor_runNames, _4_dt__update_hlast_h0, (_3_dt__update__tmp_h0).dtor_afterWouldDo, (_3_dt__update__tmp_h0).dtor_askCalls, (_3_dt__update__tmp_h0).dtor_effects);
            }(_pat_let21_0);
          }(SkopAst.Option.create_None());
        }(_pat_let20_0);
      }(s);
      let _source0 = _1_st;
      {
        if (_source0.is_Run) {
          let _5_b = (_source0).binding;
          let _6_e = SkopRun.__default.Ev(_2_s0, SkopStep.EventBody.create_RunEv((_0_n).dtor_cmd, (r).dtor_exit, (r).dtor_timedOut, (s).dtor_afterWouldDo));
          let _7_s1 = SkopRun.__default.Log(_2_s0, _6_e);
          return SkopRun.__default.Then(_6_e, ((!(SkopRun.__default.Ok(r))) ? (SkopRun.__default.Failed(_7_s1)) : ((((_5_b).is_Some) ? (SkopRun.__default.Continue(_7_s1, ((_7_s1).dtor_vars).update((_5_b).dtor_value, SkopRun.__default.RunSlot((r).dtor_stdout)))) : (SkopRun.__default.Continue(_7_s1, (_7_s1).dtor_vars))))));
        }
      }
      {
        if (_source0.is_IfYesRun) {
          let _8_e = SkopRun.__default.Ev(_2_s0, SkopStep.EventBody.create_RunEv((_0_n).dtor_cmd, (r).dtor_exit, (r).dtor_timedOut, (s).dtor_afterWouldDo));
          return SkopRun.__default.Then(_8_e, ((SkopRun.__default.Ok(r)) ? (SkopRun.__default.Continue(SkopRun.__default.Log(_2_s0, _8_e), (_2_s0).dtor_vars)) : (SkopRun.__default.Failed(SkopRun.__default.Log(_2_s0, _8_e)))));
        }
      }
      {
        if (_source0.is_Do) {
          let _9_e = SkopRun.__default.Ev(_2_s0, SkopStep.EventBody.create_EffectEndEv((_0_n).dtor_cmd, (r).dtor_exit, (r).dtor_timedOut));
          return SkopRun.__default.Then(_9_e, ((SkopRun.__default.Ok(r)) ? (SkopRun.__default.Continue(SkopRun.__default.Log(_2_s0, _9_e), (_2_s0).dtor_vars)) : (SkopRun.__default.Failed(SkopRun.__default.Log(_2_s0, _9_e)))));
        }
      }
      {
        if (_source0.is_IfYesDo) {
          let _10_e = SkopRun.__default.Ev(_2_s0, SkopStep.EventBody.create_EffectEndEv((_0_n).dtor_cmd, (r).dtor_exit, (r).dtor_timedOut));
          return SkopRun.__default.Then(_10_e, ((SkopRun.__default.Ok(r)) ? (SkopRun.__default.Continue(SkopRun.__default.Log(_2_s0, _10_e), (_2_s0).dtor_vars)) : (SkopRun.__default.Failed(SkopRun.__default.Log(_2_s0, _10_e)))));
        }
      }
      {
        if (_source0.is_Check) {
          let _11_cond = (_source0).cond;
          if ((_11_cond).is_Succeeds) {
            let _12_e = SkopRun.__default.Ev(_2_s0, SkopStep.EventBody.create_CheckCmdEv((_0_n).dtor_cmd, (r).dtor_exit, (r).dtor_timedOut, (s).dtor_afterWouldDo));
            return SkopRun.__default.Then(_12_e, ((((r).dtor_timedOut) || (((r).dtor_exit).is_None)) ? (SkopRun.__default.Failed(SkopRun.__default.Log(_2_s0, _12_e))) : (SkopRun.__default.CheckDone(SkopRun.__default.Log(_2_s0, _12_e), _dafny.areEqual((r).dtor_exit, SkopAst.Option.create_Some(_dafny.ZERO))))));
          } else {
            let _13_l = SkopRun.__default.OperandVal((_2_s0).dtor_vars, (_11_cond).dtor_l);
            let _14_rt = SkopRun.__default.OperandVal((_2_s0).dtor_vars, (_11_cond).dtor_r);
            let _15_result = ((((r).dtor_i).isEqualTo(_dafny.ZERO)) ? (SkopAst.Option.create_Some(true)) : (((((r).dtor_i).isEqualTo(_dafny.ONE)) ? (SkopAst.Option.create_Some(false)) : (SkopAst.Option.create_None()))));
            let _16_e = SkopRun.__default.Ev(_2_s0, SkopStep.EventBody.create_CheckEv(SkopRun.__default.Expr(_11_cond), SkopValues.__default.NumText(_13_l), SkopValues.__default.NumText(_14_rt), _15_result, (s).dtor_afterWouldDo));
            return SkopRun.__default.Then(_16_e, (((_15_result).is_None) ? (SkopRun.__default.Failed(SkopRun.__default.Log(_2_s0, _16_e))) : (SkopRun.__default.CheckDone(SkopRun.__default.Log(_2_s0, _16_e), (_15_result).dtor_value))));
          }
        }
      }
      {
        if (_source0.is_Ask) {
          let _17_form = (_source0).form;
          let _18_req = (_0_n).dtor_request;
          let _19_s1 = function (_pat_let22_0) {
            return function (_20_dt__update__tmp_h1) {
              return function (_pat_let23_0) {
                return function (_21_dt__update_haskCalls_h0) {
                  return SkopState.State.create_State((_20_dt__update__tmp_h1).dtor_prog, (_20_dt__update__tmp_h1).dtor_cfg, (_20_dt__update__tmp_h1).dtor_sec, (_20_dt__update__tmp_h1).dtor_tasks, (_20_dt__update__tmp_h1).dtor_vars, (_20_dt__update__tmp_h1).dtor_runNames, (_20_dt__update__tmp_h1).dtor_last, (_20_dt__update__tmp_h1).dtor_afterWouldDo, _21_dt__update_haskCalls_h0, (_20_dt__update__tmp_h1).dtor_effects);
                }(_pat_let23_0);
              }(((_2_s0).dtor_askCalls).plus(_dafny.ONE));
            }(_pat_let22_0);
          }(_2_s0);
          if ((r).is_AskFailed) {
            let _22_e = SkopRun.__default.Ev(_19_s1, SkopStep.EventBody.create_AskEv((_18_req).dtor_question, (_18_req).dtor_kind, SkopAst.Option.create_None(), SkopAst.Option.create_None(), SkopAst.Option.create_None(), (_1_st).dtor_sure, false, SkopRun.__default.Range(_17_form), SkopAst.Option.create_Some((r).dtor_error), (s).dtor_afterWouldDo));
            return SkopRun.__default.Then(_22_e, SkopRun.__default.Finish(SkopRun.__default.Log(_19_s1, _22_e), SkopStep.Outcome.create_Handoff(SkopStep.Reason.create_AskUnavailable(), SkopAst.Option.create_Some(SkopRun.__default.FailureText((r).dtor_error)))));
          } else {
            return SkopRun.__default.Answered(_19_s1, _1_st, _18_req, r);
          }
        }
      }
      {
        if (_source0.is_Page) {
          let _23_e = SkopRun.__default.Ev(_2_s0, SkopStep.EventBody.create_PageEv((_0_n).dtor_text, (r).dtor_ok));
          return SkopRun.__default.Then(_23_e, SkopRun.__default.Finish(SkopRun.__default.Log(_2_s0, _23_e), SkopStep.Outcome.create_Paged()));
        }
      }
      {
        return SkopRun.__default.Finish(_2_s0, SkopStep.Outcome.create_Stopped());
      }
    };
    static Step(s, r) {
      if ((r).is_DeadlineExceeded) {
        return SkopRun.__default.Finish(function (_pat_let24_0) {
          return function (_0_dt__update__tmp_h0) {
            return function (_pat_let25_0) {
              return function (_1_dt__update_hlast_h0) {
                return SkopState.State.create_State((_0_dt__update__tmp_h0).dtor_prog, (_0_dt__update__tmp_h0).dtor_cfg, (_0_dt__update__tmp_h0).dtor_sec, (_0_dt__update__tmp_h0).dtor_tasks, (_0_dt__update__tmp_h0).dtor_vars, (_0_dt__update__tmp_h0).dtor_runNames, _1_dt__update_hlast_h0, (_0_dt__update__tmp_h0).dtor_afterWouldDo, (_0_dt__update__tmp_h0).dtor_askCalls, (_0_dt__update__tmp_h0).dtor_effects);
              }(_pat_let25_0);
            }(SkopAst.Option.create_None());
          }(_pat_let24_0);
        }(s), SkopStep.Outcome.create_Handoff(SkopStep.Reason.create_Deadline(), SkopAst.Option.create_None()));
      } else if (((s).dtor_last).is_None) {
        return SkopRun.__default.Advance(s);
      } else {
        return SkopRun.__default.Resume(s, r);
      }
    };
  };
  return $module;
})(); // end of module SkopRun
let SkopProofs = (function() {
  let $module = {};


  $module.Trace = class Trace {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Trace(states, nexts, _$$_final) {
      let $dt = new Trace(0);
      $dt.states = states;
      $dt.nexts = nexts;
      $dt._$$_final = _$$_final;
      return $dt;
    }
    get is_Trace() { return this.$tag === 0; }
    get dtor_states() { return this.states; }
    get dtor_nexts() { return this.nexts; }
    get dtor_final() { return this._$$_final; }
    toString() {
      if (this.$tag === 0) {
        return "SkopProofs.Trace.Trace" + "(" + _dafny.toString(this.states) + ", " + _dafny.toString(this.nexts) + ", " + _dafny.toString(this._$$_final) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.states, other.states) && _dafny.areEqual(this.nexts, other.nexts) && _dafny.areEqual(this._$$_final, other._$$_final);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopProofs.Trace.create_Trace(_dafny.Seq.of(), _dafny.Seq.of(), SkopState.State.Default());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Trace.Default();
        }
      };
    }
  }
  return $module;
})(); // end of module SkopProofs
let _module = (function() {
  let $module = {};

  return $module;
})(); // end of module _module

module.exports = { _dafny, SkopAst, SkopStep, SkopWellFormed, SkopCheck, SkopValues, SkopState, SkopRun };
