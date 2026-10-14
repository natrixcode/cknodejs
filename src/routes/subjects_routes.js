const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:id',SomeFunction)
route.post('/',SomeFunction)
route.patch('/:id',SomeFunction)
route.get('/:id/teachers',SomeFunction)
route.put('/:id/teachers',SomeFunction)




module.exports = route