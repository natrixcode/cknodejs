const express = require('express')
const route = express.Router()

route.get('/',SomeFunction)
route.get('/:id',SomeFunction)
route.post('/',SomeFunction)
route.patch('/:id',SomeFunction)
route.get('/:childId/discounts',SomeFunction)
route.post('/:childId/discounts',SomeFunction)
route.delete('/:childId/discounts/:discountId',SomeFunction)




module.exports = route