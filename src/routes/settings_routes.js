const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:key',SomeFunction)
route.patch('/:key',SomeFunction)
route.get('/academic-year',SomeFunction)
route.put('/academic-year',SomeFunction)




module.exports = route