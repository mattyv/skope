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
let SkopSyntax = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "SkopSyntax._default";
    }
    _parentTraits() {
      return [];
    }
    static Render(parts) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((parts).length)).isEqualTo(_dafny.ZERO)) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.UnicodeFromString(""));
        } else {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, ((parts)[_dafny.ZERO]).dtor_s);
          let _in0 = (parts).slice(_dafny.ONE);
          parts = _in0;
          continue TAIL_CALL_START;
        }
      }
    };
  };

  $module.Kind = class Kind {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_RunKind() {
      let $dt = new Kind(0);
      return $dt;
    }
    static create_DoKind() {
      let $dt = new Kind(1);
      return $dt;
    }
    get is_RunKind() { return this.$tag === 0; }
    get is_DoKind() { return this.$tag === 1; }
    static get AllSingletonConstructors() {
      return this.AllSingletonConstructors_();
    }
    static *AllSingletonConstructors_() {
      yield Kind.create_RunKind();
      yield Kind.create_DoKind();
    }
    toString() {
      if (this.$tag === 0) {
        return "SkopSyntax.Kind.RunKind";
      } else if (this.$tag === 1) {
        return "SkopSyntax.Kind.DoKind";
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
      return SkopSyntax.Kind.create_RunKind();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Kind.Default();
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
    get is_Lit() { return this.$tag === 0; }
    get dtor_s() { return this.s; }
    toString() {
      if (this.$tag === 0) {
        return "SkopSyntax.Part.Lit" + "(" + this.s.toVerbatimString(true) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.s, other.s);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopSyntax.Part.create_Lit(_dafny.Seq.UnicodeFromString(""));
    }
    static Rtd() {
      return class {
        static get Default() {
          return Part.Default();
        }
      };
    }
  }

  $module.Stmt = class Stmt {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Run(src, cmd) {
      let $dt = new Stmt(0);
      $dt.src = src;
      $dt.cmd = cmd;
      return $dt;
    }
    static create_Do(src, cmd) {
      let $dt = new Stmt(1);
      $dt.src = src;
      $dt.cmd = cmd;
      return $dt;
    }
    static create_Stop(src) {
      let $dt = new Stmt(2);
      $dt.src = src;
      return $dt;
    }
    get is_Run() { return this.$tag === 0; }
    get is_Do() { return this.$tag === 1; }
    get is_Stop() { return this.$tag === 2; }
    get dtor_src() { return this.src; }
    get dtor_cmd() { return this.cmd; }
    toString() {
      if (this.$tag === 0) {
        return "SkopSyntax.Stmt.Run" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.cmd) + ")";
      } else if (this.$tag === 1) {
        return "SkopSyntax.Stmt.Do" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.cmd) + ")";
      } else if (this.$tag === 2) {
        return "SkopSyntax.Stmt.Stop" + "(" + _dafny.toString(this.src) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.cmd, other.cmd);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.cmd, other.cmd);
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.src, other.src);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopSyntax.Stmt.create_Run(_dafny.ZERO, _dafny.Seq.of());
    }
    static Rtd() {
      return class {
        static get Default() {
          return Stmt.Default();
        }
      };
    }
  }

  $module.Program = class Program {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Program(src, body) {
      let $dt = new Program(0);
      $dt.src = src;
      $dt.body = body;
      return $dt;
    }
    get is_Program() { return this.$tag === 0; }
    get dtor_src() { return this.src; }
    get dtor_body() { return this.body; }
    toString() {
      if (this.$tag === 0) {
        return "SkopSyntax.Program.Program" + "(" + _dafny.toString(this.src) + ", " + _dafny.toString(this.body) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.body, other.body);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopSyntax.Program.create_Program(_dafny.ZERO, _dafny.Seq.of());
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
})(); // end of module SkopSyntax
let SkopLint = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "SkopLint._default";
    }
    _parentTraits() {
      return [];
    }
    static FallsOff(p) {
      if ((new BigNumber(((p).dtor_body).length)).isEqualTo(_dafny.ZERO)) {
        return _dafny.Seq.of(SkopLint.LintError.create_LintError(_dafny.Seq.UnicodeFromString("E-FALLS-OFF"), (p).dtor_src));
      } else if ((((p).dtor_body)[(new BigNumber(((p).dtor_body).length)).minus(_dafny.ONE)]).is_Stop) {
        return _dafny.Seq.of();
      } else {
        return _dafny.Seq.of(SkopLint.LintError.create_LintError(_dafny.Seq.UnicodeFromString("E-FALLS-OFF"), (((p).dtor_body)[(new BigNumber(((p).dtor_body).length)).minus(_dafny.ONE)]).dtor_src));
      }
    };
    static Unreachable(body, i) {
      let _0___accumulator = _dafny.Seq.of();
      TAIL_CALL_START: while (true) {
        if ((new BigNumber((body).length)).isLessThanOrEqualTo((i).plus(_dafny.ONE))) {
          return _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of());
        } else if (((body)[i]).is_Stop) {
          _0___accumulator = _dafny.Seq.Concat(_0___accumulator, _dafny.Seq.of(SkopLint.LintError.create_LintError(_dafny.Seq.UnicodeFromString("E-UNREACHABLE"), ((body)[(i).plus(_dafny.ONE)]).dtor_src)));
          let _in0 = body;
          let _in1 = (i).plus(_dafny.ONE);
          body = _in0;
          i = _in1;
          continue TAIL_CALL_START;
        } else {
          let _in2 = body;
          let _in3 = (i).plus(_dafny.ONE);
          body = _in2;
          i = _in3;
          continue TAIL_CALL_START;
        }
      }
    };
    static Lint(p) {
      return _dafny.Seq.Concat(SkopLint.__default.FallsOff(p), SkopLint.__default.Unreachable((p).dtor_body, _dafny.ZERO));
    };
  };

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
        return "SkopLint.LintError.LintError" + "(" + this.code.toVerbatimString(true) + ", " + _dafny.toString(this.src) + ")";
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
      return SkopLint.LintError.create_LintError(_dafny.Seq.UnicodeFromString(""), _dafny.ZERO);
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
})(); // end of module SkopLint
let SkopInterp = (function() {
  let $module = {};

  $module.__default = class __default {
    constructor () {
      this._tname = "SkopInterp._default";
    }
    _parentTraits() {
      return [];
    }
    static Measure(s) {
      return ((new BigNumber(2)).multipliedBy((new BigNumber((((s).dtor_prog).dtor_body).length)).minus((s).dtor_pc))).minus((((s).dtor_waiting) ? (_dafny.ONE) : (_dafny.ZERO)));
    };
    static Start(p, dry) {
      return SkopInterp.State.create_State(p, _dafny.ZERO, dry, false, false, false);
    };
    static Advance(s) {
      let _pat_let_tv0 = s;
      let _source0 = (((s).dtor_prog).dtor_body)[(s).dtor_pc];
      {
        if (_source0.is_Stop) {
          return _dafny.Tuple.of(function (_pat_let0_0) {
  return function (_0_dt__update__tmp_h0) {
    return function (_pat_let1_0) {
      return function (_1_dt__update_hdone_h0) {
        return SkopInterp.State.create_State((_0_dt__update__tmp_h0).dtor_prog, (_0_dt__update__tmp_h0).dtor_pc, (_0_dt__update__tmp_h0).dtor_dry, (_0_dt__update__tmp_h0).dtor_waiting, _1_dt__update_hdone_h0, (_0_dt__update__tmp_h0).dtor_afterWouldDo);
      }(_pat_let1_0);
    }(true);
  }(_pat_let0_0);
}(s), _dafny.Seq.of(SkopInterp.Event.create_Finished(SkopInterp.Outcome.create_Stopped())), SkopInterp.Next.create_Done(SkopInterp.Outcome.create_Stopped()));
        }
      }
      {
        if (_source0.is_Run) {
          let _2_src = (_source0).src;
          let _3_cmd = (_source0).cmd;
          return _dafny.Tuple.of(function (_pat_let2_0) {
  return function (_4_dt__update__tmp_h1) {
    return function (_pat_let3_0) {
      return function (_5_dt__update_hwaiting_h0) {
        return SkopInterp.State.create_State((_4_dt__update__tmp_h1).dtor_prog, (_4_dt__update__tmp_h1).dtor_pc, (_4_dt__update__tmp_h1).dtor_dry, _5_dt__update_hwaiting_h0, (_4_dt__update__tmp_h1).dtor_done, (_4_dt__update__tmp_h1).dtor_afterWouldDo);
      }(_pat_let3_0);
    }(true);
  }(_pat_let2_0);
}(s), _dafny.Seq.of(), SkopInterp.Next.create_Exec(SkopSyntax.Kind.create_RunKind(), SkopSyntax.__default.Render(_3_cmd), _2_src));
        }
      }
      {
        let _6_src = (_source0).src;
        let _7_cmd = (_source0).cmd;
        if ((s).dtor_dry) {
          let _8_r = SkopInterp.__default.Advance(function (_pat_let4_0) {
            return function (_9_dt__update__tmp_h2) {
              return function (_pat_let5_0) {
                return function (_10_dt__update_hafterWouldDo_h0) {
                  return function (_pat_let6_0) {
                    return function (_11_dt__update_hpc_h0) {
                      return SkopInterp.State.create_State((_9_dt__update__tmp_h2).dtor_prog, _11_dt__update_hpc_h0, (_9_dt__update__tmp_h2).dtor_dry, (_9_dt__update__tmp_h2).dtor_waiting, (_9_dt__update__tmp_h2).dtor_done, _10_dt__update_hafterWouldDo_h0);
                    }(_pat_let6_0);
                  }(((_pat_let_tv0).dtor_pc).plus(_dafny.ONE));
                }(_pat_let5_0);
              }(true);
            }(_pat_let4_0);
          }(s));
          return _dafny.Tuple.of((_8_r)[0], _dafny.Seq.Concat(_dafny.Seq.of(SkopInterp.Event.create_WouldDo(_6_src, SkopSyntax.__default.Render(_7_cmd))), (_8_r)[1]), (_8_r)[2]);
        } else {
          return _dafny.Tuple.of(function (_pat_let7_0) {
  return function (_12_dt__update__tmp_h3) {
    return function (_pat_let8_0) {
      return function (_13_dt__update_hwaiting_h1) {
        return SkopInterp.State.create_State((_12_dt__update__tmp_h3).dtor_prog, (_12_dt__update__tmp_h3).dtor_pc, (_12_dt__update__tmp_h3).dtor_dry, _13_dt__update_hwaiting_h1, (_12_dt__update__tmp_h3).dtor_done, (_12_dt__update__tmp_h3).dtor_afterWouldDo);
      }(_pat_let8_0);
    }(true);
  }(_pat_let7_0);
}(s), _dafny.Seq.of(SkopInterp.Event.create_EffectStart(_6_src, SkopSyntax.__default.Render(_7_cmd))), SkopInterp.Next.create_Exec(SkopSyntax.Kind.create_DoKind(), SkopSyntax.__default.Render(_7_cmd), _6_src));
        }
      }
    };
    static Step(s, r) {
      let _pat_let_tv0 = s;
      if (!((s).dtor_waiting)) {
        return SkopInterp.__default.Advance(s);
      } else {
        let _0_st = (((s).dtor_prog).dtor_body)[(s).dtor_pc];
        let _1_cmd = SkopSyntax.__default.Render((_0_st).dtor_cmd);
        let _2_ended = (((_0_st).is_Run) ? (_dafny.Seq.of(SkopInterp.Event.create_RunDone((_0_st).dtor_src, _1_cmd, (r).dtor_exit, (s).dtor_afterWouldDo))) : (_dafny.Seq.of(SkopInterp.Event.create_EffectEnd((_0_st).dtor_src, _1_cmd, (r).dtor_exit))));
        if (!((r).dtor_exit).isEqualTo(_dafny.ZERO)) {
          return _dafny.Tuple.of(function (_pat_let9_0) {
  return function (_3_dt__update__tmp_h0) {
    return function (_pat_let10_0) {
      return function (_4_dt__update_hdone_h0) {
        return function (_pat_let11_0) {
          return function (_5_dt__update_hwaiting_h0) {
            return SkopInterp.State.create_State((_3_dt__update__tmp_h0).dtor_prog, (_3_dt__update__tmp_h0).dtor_pc, (_3_dt__update__tmp_h0).dtor_dry, _5_dt__update_hwaiting_h0, _4_dt__update_hdone_h0, (_3_dt__update__tmp_h0).dtor_afterWouldDo);
          }(_pat_let11_0);
        }(false);
      }(_pat_let10_0);
    }(true);
  }(_pat_let9_0);
}(s), _dafny.Seq.Concat(_2_ended, _dafny.Seq.of(SkopInterp.Event.create_Finished(SkopInterp.Outcome.create_Handoff(_dafny.Seq.UnicodeFromString("command_failed"))))), SkopInterp.Next.create_Done(SkopInterp.Outcome.create_Handoff(_dafny.Seq.UnicodeFromString("command_failed"))));
        } else {
          let _6_a = SkopInterp.__default.Advance(function (_pat_let12_0) {
            return function (_7_dt__update__tmp_h1) {
              return function (_pat_let13_0) {
                return function (_8_dt__update_hwaiting_h1) {
                  return function (_pat_let14_0) {
                    return function (_9_dt__update_hpc_h0) {
                      return SkopInterp.State.create_State((_7_dt__update__tmp_h1).dtor_prog, _9_dt__update_hpc_h0, (_7_dt__update__tmp_h1).dtor_dry, _8_dt__update_hwaiting_h1, (_7_dt__update__tmp_h1).dtor_done, (_7_dt__update__tmp_h1).dtor_afterWouldDo);
                    }(_pat_let14_0);
                  }(((_pat_let_tv0).dtor_pc).plus(_dafny.ONE));
                }(_pat_let13_0);
              }(false);
            }(_pat_let12_0);
          }(s));
          return _dafny.Tuple.of((_6_a)[0], _dafny.Seq.Concat(_2_ended, (_6_a)[1]), (_6_a)[2]);
        }
      }
    };
  };

  $module.Outcome = class Outcome {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Stopped() {
      let $dt = new Outcome(0);
      return $dt;
    }
    static create_Handoff(reason) {
      let $dt = new Outcome(1);
      $dt.reason = reason;
      return $dt;
    }
    get is_Stopped() { return this.$tag === 0; }
    get is_Handoff() { return this.$tag === 1; }
    get dtor_reason() { return this.reason; }
    toString() {
      if (this.$tag === 0) {
        return "SkopInterp.Outcome.Stopped";
      } else if (this.$tag === 1) {
        return "SkopInterp.Outcome.Handoff" + "(" + this.reason.toVerbatimString(true) + ")";
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
        return other.$tag === 1 && _dafny.areEqual(this.reason, other.reason);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopInterp.Outcome.create_Stopped();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Outcome.Default();
        }
      };
    }
  }

  $module.Event = class Event {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_RunDone(src, cmd, exit, afterWouldDo) {
      let $dt = new Event(0);
      $dt.src = src;
      $dt.cmd = cmd;
      $dt.exit = exit;
      $dt.afterWouldDo = afterWouldDo;
      return $dt;
    }
    static create_EffectStart(src, cmd) {
      let $dt = new Event(1);
      $dt.src = src;
      $dt.cmd = cmd;
      return $dt;
    }
    static create_EffectEnd(src, cmd, exit) {
      let $dt = new Event(2);
      $dt.src = src;
      $dt.cmd = cmd;
      $dt.exit = exit;
      return $dt;
    }
    static create_WouldDo(src, cmd) {
      let $dt = new Event(3);
      $dt.src = src;
      $dt.cmd = cmd;
      return $dt;
    }
    static create_Finished(outcome) {
      let $dt = new Event(4);
      $dt.outcome = outcome;
      return $dt;
    }
    get is_RunDone() { return this.$tag === 0; }
    get is_EffectStart() { return this.$tag === 1; }
    get is_EffectEnd() { return this.$tag === 2; }
    get is_WouldDo() { return this.$tag === 3; }
    get is_Finished() { return this.$tag === 4; }
    get dtor_src() { return this.src; }
    get dtor_cmd() { return this.cmd; }
    get dtor_exit() { return this.exit; }
    get dtor_afterWouldDo() { return this.afterWouldDo; }
    get dtor_outcome() { return this.outcome; }
    toString() {
      if (this.$tag === 0) {
        return "SkopInterp.Event.RunDone" + "(" + _dafny.toString(this.src) + ", " + this.cmd.toVerbatimString(true) + ", " + _dafny.toString(this.exit) + ", " + _dafny.toString(this.afterWouldDo) + ")";
      } else if (this.$tag === 1) {
        return "SkopInterp.Event.EffectStart" + "(" + _dafny.toString(this.src) + ", " + this.cmd.toVerbatimString(true) + ")";
      } else if (this.$tag === 2) {
        return "SkopInterp.Event.EffectEnd" + "(" + _dafny.toString(this.src) + ", " + this.cmd.toVerbatimString(true) + ", " + _dafny.toString(this.exit) + ")";
      } else if (this.$tag === 3) {
        return "SkopInterp.Event.WouldDo" + "(" + _dafny.toString(this.src) + ", " + this.cmd.toVerbatimString(true) + ")";
      } else if (this.$tag === 4) {
        return "SkopInterp.Event.Finished" + "(" + _dafny.toString(this.outcome) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.cmd, other.cmd) && _dafny.areEqual(this.exit, other.exit) && this.afterWouldDo === other.afterWouldDo;
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.cmd, other.cmd);
      } else if (this.$tag === 2) {
        return other.$tag === 2 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.cmd, other.cmd) && _dafny.areEqual(this.exit, other.exit);
      } else if (this.$tag === 3) {
        return other.$tag === 3 && _dafny.areEqual(this.src, other.src) && _dafny.areEqual(this.cmd, other.cmd);
      } else if (this.$tag === 4) {
        return other.$tag === 4 && _dafny.areEqual(this.outcome, other.outcome);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopInterp.Event.create_RunDone(_dafny.ZERO, _dafny.Seq.UnicodeFromString(""), _dafny.ZERO, false);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Event.Default();
        }
      };
    }
  }

  $module.Next = class Next {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_Exec(kind, cmd, src) {
      let $dt = new Next(0);
      $dt.kind = kind;
      $dt.cmd = cmd;
      $dt.src = src;
      return $dt;
    }
    static create_Done(outcome) {
      let $dt = new Next(1);
      $dt.outcome = outcome;
      return $dt;
    }
    get is_Exec() { return this.$tag === 0; }
    get is_Done() { return this.$tag === 1; }
    get dtor_kind() { return this.kind; }
    get dtor_cmd() { return this.cmd; }
    get dtor_src() { return this.src; }
    get dtor_outcome() { return this.outcome; }
    toString() {
      if (this.$tag === 0) {
        return "SkopInterp.Next.Exec" + "(" + _dafny.toString(this.kind) + ", " + this.cmd.toVerbatimString(true) + ", " + _dafny.toString(this.src) + ")";
      } else if (this.$tag === 1) {
        return "SkopInterp.Next.Done" + "(" + _dafny.toString(this.outcome) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.kind, other.kind) && _dafny.areEqual(this.cmd, other.cmd) && _dafny.areEqual(this.src, other.src);
      } else if (this.$tag === 1) {
        return other.$tag === 1 && _dafny.areEqual(this.outcome, other.outcome);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopInterp.Next.create_Exec(SkopSyntax.Kind.Default(), _dafny.Seq.UnicodeFromString(""), _dafny.ZERO);
    }
    static Rtd() {
      return class {
        static get Default() {
          return Next.Default();
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
    static create_ExecResult(exit) {
      let $dt = new Response(1);
      $dt.exit = exit;
      return $dt;
    }
    get is_NoResponse() { return this.$tag === 0; }
    get is_ExecResult() { return this.$tag === 1; }
    get dtor_exit() { return this.exit; }
    toString() {
      if (this.$tag === 0) {
        return "SkopInterp.Response.NoResponse";
      } else if (this.$tag === 1) {
        return "SkopInterp.Response.ExecResult" + "(" + _dafny.toString(this.exit) + ")";
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
        return other.$tag === 1 && _dafny.areEqual(this.exit, other.exit);
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopInterp.Response.create_NoResponse();
    }
    static Rtd() {
      return class {
        static get Default() {
          return Response.Default();
        }
      };
    }
  }

  $module.State = class State {
    constructor(tag) {
      this.$tag = tag;
    }
    static create_State(prog, pc, dry, waiting, done, afterWouldDo) {
      let $dt = new State(0);
      $dt.prog = prog;
      $dt.pc = pc;
      $dt.dry = dry;
      $dt.waiting = waiting;
      $dt.done = done;
      $dt.afterWouldDo = afterWouldDo;
      return $dt;
    }
    get is_State() { return this.$tag === 0; }
    get dtor_prog() { return this.prog; }
    get dtor_pc() { return this.pc; }
    get dtor_dry() { return this.dry; }
    get dtor_waiting() { return this.waiting; }
    get dtor_done() { return this.done; }
    get dtor_afterWouldDo() { return this.afterWouldDo; }
    toString() {
      if (this.$tag === 0) {
        return "SkopInterp.State.State" + "(" + _dafny.toString(this.prog) + ", " + _dafny.toString(this.pc) + ", " + _dafny.toString(this.dry) + ", " + _dafny.toString(this.waiting) + ", " + _dafny.toString(this.done) + ", " + _dafny.toString(this.afterWouldDo) + ")";
      } else  {
        return "<unexpected>";
      }
    }
    equals(other) {
      if (this === other) {
        return true;
      } else if (this.$tag === 0) {
        return other.$tag === 0 && _dafny.areEqual(this.prog, other.prog) && _dafny.areEqual(this.pc, other.pc) && this.dry === other.dry && this.waiting === other.waiting && this.done === other.done && this.afterWouldDo === other.afterWouldDo;
      } else  {
        return false; // unexpected
      }
    }
    static Default() {
      return SkopInterp.State.create_State(SkopSyntax.Program.Default(), _dafny.ZERO, false, false, false, false);
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
})(); // end of module SkopInterp
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
let _module = (function() {
  let $module = {};

  return $module;
})(); // end of module _module

module.exports = { _dafny, SkopSyntax, SkopLint, SkopInterp, SkopAst, SkopStep };
