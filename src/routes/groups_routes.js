const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:id',SomeFunction)
route.post('/',SomeFunction)
route.patch('/:id',SomeFunction)
route.patch('/:id/status',SomeFunction)
route.get('/:id/children',SomeFunction)
route.post('/:id/children',SomeFunction)
route.delete('/:id/children/:childId',SomeFunction)
route.get('/:id/employees',SomeFunction)
route.delete('/:id/employees/:employeeId',SomeFunction)
route.get('/:id/schedule',SomeFunction)
route.get('/:id/finance',SomeFunction)
route.get('/:id/capacity',SomeFunction)



module.exports = route