const express = require('express')
const route = express.Router()

route.post('/login',SomeFunction)
route.post('/logout',SomeFunction)

module.exports = route