const express = require('express');
const router = express.Router();

router.get('/finance',SomeFunction)
router.get('/profit',SomeFunction)
router.get('/profit/groups',SomeFunction)
router.get('/profit/groups/:groupId',SomeFunction)
router.get('/expenses',SomeFunction)
router.get('/revenue',SomeFunction)
router.get('/salaries',SomeFunction)
router.get('/break-even', SomeFunction)
router.get('/dashboard', SomeFunction)




module.exports = router;