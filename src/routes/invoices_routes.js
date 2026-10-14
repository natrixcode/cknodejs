const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:id',SomeFunction)
route.post('/',SomeFunction)
route.post('/:id/recalculate',SomeFunction)
route.get('/:id/items',SomeFunction)
route.post('/:id/cancel',SomeFunction)




module.exports = route