const express = require('express')
const route = express.Router()

route.get('/rates',SomeFunction)
route.get('/rates/:id',SomeFunction)
route.post('/rates',SomeFunction)
route.patch('/rates/:id',SomeFunction)
route.get('/calculate',SomeFunction)




module.exports = route