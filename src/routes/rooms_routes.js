const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:id',SomeFunction)
route.post('/',SomeFunction)
route.patch('/:id',SomeFunction)
route.get('/:id/schedule',SomeFunction)
route.patch('/:id/status',SomeFunction)




module.exports = route