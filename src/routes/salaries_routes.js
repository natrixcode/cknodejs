const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:id',SomeFunction)
route.post('/calculate',SomeFunction)
route.get('/:employeeId/salaries',SomeFunction)





module.exports = route