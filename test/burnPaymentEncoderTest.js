/* eslint-env mocha */
const paymentEncode = require('../index').BurnPaymentEncoder
const assert = require('assert')

const consumer = function (buff) {
  let curr = 0
  return function consume(len) {
    return buff.slice(curr, (curr += len))
  }
}

describe('Payment Decode Encode', function () {
  it('should return the right decoding', function (done) {
    const testCase = [
      { skip: false, range: false, percent: true, output: 12, amount: 3213213 },
      { skip: true, range: false, percent: false, output: 14, amount: 321321 },
      { skip: false, range: false, percent: false, output: 2, amount: 321321 },
      { skip: true, range: true, percent: false, output: 0, amount: 1000000 },
      {
        skip: false,
        range: false,
        percent: true,
        output: 1,
        amount: 321321321,
      },
      {
        skip: true,
        range: true,
        percent: false,
        output: 5,
        amount: 10000003321,
      },
      {
        skip: false,
        range: false,
        percent: true,
        output: 20,
        amount: 100000021000,
      },
      {
        skip: true,
        range: false,
        percent: false,
        output: 22,
        amount: 1000000210002,
      },
      { skip: false, range: false, percent: true, output: 11, amount: 321 },
      { skip: true, range: true, percent: true, output: 10, amount: 1 },
      {
        skip: true,
        range: true,
        percent: true,
        output: 10,
        amount: 1323004030000,
      },
    ]

    for (let i = 0; i < testCase.length; i++) {
      const code = paymentEncode.encode(testCase[i])
      const decode = paymentEncode.decode(consumer(code))
      assert.strictEqual(testCase[i].skip, decode.skip)
      assert.strictEqual(testCase[i].range, decode.range)
      assert.strictEqual(testCase[i].percent, decode.percent)
      assert.strictEqual(testCase[i].output, decode.output)
      assert.strictEqual(testCase[i].amount, decode.amount)
    }
    done()
  })

  it('should return the right encoding for burn', function (done) {
    const testCase1 = paymentEncode.encode({
      skip: false,
      percent: false,
      amount: 13,
      burn: true,
    })
    const testCase2 = paymentEncode.encode({
      skip: true,
      percent: false,
      amount: 123,
      burn: true,
    })
    const testCase3 = paymentEncode.encode({
      skip: false,
      percent: true,
      amount: 25,
      burn: true,
    })
    const testCase4 = paymentEncode.encode({
      skip: true,
      percent: true,
      amount: 10,
      burn: true,
    })
    assert.deepEqual(testCase1, Buffer.from([0x1f, 0x0d]))
    assert.deepEqual(testCase2, Buffer.from([0x9f, 0x27, 0xb0]))
    assert.deepEqual(testCase3, Buffer.from([0x3f, 0x19]))
    assert.deepEqual(testCase4, Buffer.from([0xbf, 0x0a]))
    done()
  })

  it('should return the right decoding for burn', function (done) {
    const testCases = [
      { skip: false, percent: false, amount: 3213213, burn: true },
      { skip: true, percent: false, amount: 3213213, burn: true },
      { skip: false, percent: true, amount: 50, burn: true },
      { skip: true, percent: true, amount: 13, burn: true },
    ]

    for (let i = 0; i < testCases.length; i++) {
      const code = paymentEncode.encode(testCases[i])
      const decode = paymentEncode.decode(consumer(code))
      assert.strictEqual(testCases[i].skip, decode.skip)
      assert.strictEqual(testCases[i].percent, decode.percent)
      assert.strictEqual(testCases[i].burn, decode.burn)
      assert.strictEqual(testCases[i].amount, decode.amount)
    }
    done()
  })

  it('should return the right decoding for bulk operations', function (done) {
    const testCase = [
      { skip: false, range: false, percent: true, output: 12, amount: 3213213 },
      { skip: true, range: false, percent: false, output: 14, amount: 321321 },
      { skip: false, range: false, percent: false, output: 2, amount: 321321 },
      { skip: true, range: true, percent: false, output: 0, amount: 1000000 },
      {
        skip: false,
        range: false,
        percent: true,
        output: 1,
        amount: 321321321,
      },
      {
        skip: true,
        range: true,
        percent: false,
        output: 5,
        amount: 10000003321,
      },
      {
        skip: false,
        range: false,
        percent: true,
        output: 20,
        amount: 100000021000,
      },
      {
        skip: true,
        range: false,
        percent: false,
        output: 22,
        amount: 1000000210002,
      },
      { skip: false, range: false, percent: true, output: 11, amount: 321 },
      { skip: true, range: true, percent: true, output: 10, amount: 1 },
      {
        skip: true,
        range: true,
        percent: true,
        output: 10,
        amount: 1323004030000,
      },
    ]

    const code = paymentEncode.encodeBulk(testCase)
    const decode = paymentEncode.decodeBulk(consumer(code))

    for (let i = 0; i < testCase.length; i++) {
      assert.strictEqual(testCase[i].skip, decode[i].skip)
      assert.strictEqual(testCase[i].range, decode[i].range)
      assert.strictEqual(testCase[i].percent, decode[i].percent)
      assert.strictEqual(testCase[i].output, decode[i].output)
      assert.strictEqual(testCase[i].amount, decode[i].amount)
    }
    done()
  })

  it('should throw output value out of bounds error', function (done) {
    const testCases = [
      {
        skip: false,
        range: false,
        percent: true,
        output: 256,
        amount: 3213213,
      },
      { skip: true, range: true, percent: false, output: 8192, amount: 321321 },
    ]

    for (let i = 0; i < testCases.length; i++) {
      assert.throws(
        function () {
          paymentEncode.encode(testCases[i])
        },
        /Output value is out of bounds/,
        'Should Throw Error'
      )
    }
    done()
  })

  it('should throw output value out of bounds for burn case', function (done) {
    const testCase = {
      skip: false,
      range: false,
      percent: false,
      output: 31,
      amount: 123192,
    }

    assert.throws(
      function () {
        paymentEncode.encode(testCase, true)
      },
      /Received range and output values reserved to represent burn/,
      'Should Throw Error'
    )

    done()
  })

  it('should throw output value negative error', function (done) {
    const testCase = {
      skip: true,
      range: true,
      percent: false,
      output: -1,
      amount: 321321,
    }
    assert.throws(
      function () {
        paymentEncode.encode(testCase)
      },
      /Output Can't be negative/,
      'Should Throw Error'
    )
    done()
  })

  it('should throw no output error', function (done) {
    const testCases = [
      { skip: true, range: true, percent: true, amount: 1323004030000 },
      {
        skip: true,
        range: true,
        percent: true,
        amount: 1323004030000,
        burn: false,
      },
    ]

    for (let i = 0; i < testCases.length; i++) {
      assert.throws(
        function () {
          paymentEncode.encode(testCases[i])
        },
        /Needs output value/,
        'Should Throw Error'
      )
    }
    done()
  })

  it('should throw both burn and output value are specified', function (done) {
    const testCase = {
      skip: true,
      percent: true,
      output: 12,
      amount: 1323004030000,
      burn: true,
    }

    assert.throws(
      function () {
        paymentEncode.encode(testCase)
      },
      /Received both burn and output/,
      'Should Throw Error'
    )
    done()
  })

  it('should throw both burn and range are specified', function (done) {
    const testCase = {
      skip: true,
      range: true,
      percent: true,
      amount: 1323004030000,
      burn: true,
    }

    assert.throws(
      function () {
        paymentEncode.encode(testCase)
      },
      /Received both burn and range/,
      'Should Throw Error'
    )
    done()
  })

  it('should throw no amount error', function (done) {
    const testCase = { skip: true, range: true, percent: true, output: 12 }
    assert.throws(
      function () {
        paymentEncode.encode(testCase)
      },
      /Needs amount value/,
      'Should Throw Error'
    )
    done()
  })
})
