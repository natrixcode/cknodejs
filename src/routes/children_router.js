const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:id',SomeFunction)
route.post('/',SomeFunction)
route.patch('/:id',SomeFunction)
route.get('/:id/parents',SomeFunction)
route.get('/:id/groups',SomeFunction)
route.get('/:id/invoices',SomeFunction)
route.get('/:id/payments',SomeFunction)
route.get('/:id/schedule',SomeFunction)

module.exports = route