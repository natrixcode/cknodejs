const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/live',SomeFunction)
route.get('/ready',SomeFunction)





module.exports = route