const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:id',SomeFunction)
route.post('/',SomeFunction)
route.patch('/:id',SomeFunction)
route.get('/:id/children',SomeFunction)
route.post('/:id/children',SomeFunction)
route.get('/:id/invoices',SomeFunction)
route.get('/:id/payments',SomeFunction)


module.exports = route