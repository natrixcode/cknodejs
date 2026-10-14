const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:id',SomeFunction)
route.post('/',SomeFunction)
route.patch('/:id',SomeFunction)
route.patch('/:id/status',SomeFunction)
route.get('/:id/groups',SomeFunction)
route.get('/:id/subjects',SomeFunction)
route.put('/:id/subjects',SomeFunction)
route.get('/:id/schedule',SomeFunction)
route.get('/:id/salary',SomeFunction)



module.exports = route