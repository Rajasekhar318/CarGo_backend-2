const express = require('express');
const { body, validationResult } = require('express-validator');
const Car = require('../models/Car');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get dashboard stats
router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    const totalCars = await Car.countDocuments();
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalBookings = await Booking.countDocuments();
    const activeBookings = await Booking.countDocuments({ 
      status: { $in: ['confirmed', 'pending'] } 
    });

    // Calculate total revenue
    const revenueResult = await Booking.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } }
    ]);
    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    // Recent bookings
    const recentBookings = await Booking.find()
      .populate('user', 'name email')
      .populate('car', 'title brand model')
      .sort({ createdAt: -1 })
      .limit(5);

    // Monthly booking stats
    const monthlyStats = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(new Date().getFullYear(), 0, 1) }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      stats: {
        totalCars,
        totalUsers,
        totalBookings,
        activeBookings,
        totalRevenue
      },
      recentBookings,
      monthlyStats
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Server error while fetching dashboard data' });
  }
});

// Add new car
router.post('/cars', adminAuth, [
  body('title').trim().isLength({ min: 1 }).withMessage('Title is required'),
  body('brand').trim().isLength({ min: 1 }).withMessage('Brand is required'),
  body('model').trim().isLength({ min: 1 }).withMessage('Model is required'),
  body('year').isInt({ min: 1990 }).withMessage('Year must be 1990 or later'),
  body('pricePerDay').isFloat({ min: 0 }).withMessage('Price per day must be non-negative'),
  body('pricePerHour').isFloat({ min: 0 }).withMessage('Price per hour must be non-negative'),
  body('fuelType').isIn(['Petrol', 'Diesel', 'Electric', 'Hybrid', 'CNG']).withMessage('Invalid fuel type'),
  body('transmission').isIn(['Manual', 'Automatic']).withMessage('Invalid transmission type'),
  body('mileage').isFloat({ min: 0 }).withMessage('Mileage must be non-negative'),
  body('seats').isInt({ min: 2, max: 8 }).withMessage('Seats must be between 2 and 8'),
  body('image').isURL().withMessage('Image must be a valid URL'),
  body('location').trim().isLength({ min: 1 }).withMessage('Location is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const car = new Car(req.body);
    await car.save();

    res.status(201).json({
      message: 'Car added successfully',
      car
    });
  } catch (error) {
    console.error('Add car error:', error);
    res.status(500).json({ message: 'Server error while adding car' });
  }
});

// Update car
router.put('/cars/:id', adminAuth, [
  body('title').optional().trim().isLength({ min: 1 }).withMessage('Title cannot be empty'),
  body('brand').optional().trim().isLength({ min: 1 }).withMessage('Brand cannot be empty'),
  body('model').optional().trim().isLength({ min: 1 }).withMessage('Model cannot be empty'),
  body('year').optional().isInt({ min: 1990 }).withMessage('Year must be 1990 or later'),
  body('pricePerDay').optional().isFloat({ min: 0 }).withMessage('Price per day must be non-negative'),
  body('pricePerHour').optional().isFloat({ min: 0 }).withMessage('Price per hour must be non-negative'),
  body('fuelType').optional().isIn(['Petrol', 'Diesel', 'Electric', 'Hybrid', 'CNG']).withMessage('Invalid fuel type'),
  body('transmission').optional().isIn(['Manual', 'Automatic']).withMessage('Invalid transmission type'),
  body('mileage').optional().isFloat({ min: 0 }).withMessage('Mileage must be non-negative'),
  body('seats').optional().isInt({ min: 2, max: 8 }).withMessage('Seats must be between 2 and 8'),
  body('image').optional().isURL().withMessage('Image must be a valid URL'),
  body('location').optional().trim().isLength({ min: 1 }).withMessage('Location cannot be empty')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const car = await Car.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    res.json({
      message: 'Car updated successfully',
      car
    });
  } catch (error) {
    console.error('Update car error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid car ID' });
    }
    res.status(500).json({ message: 'Server error while updating car' });
  }
});

// Delete car
router.delete('/cars/:id', adminAuth, async (req, res) => {
  try {
    // Check if car has active bookings
    const activeBookings = await Booking.countDocuments({
      car: req.params.id,
      status: { $in: ['confirmed', 'pending'] }
    });

    if (activeBookings > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete car with active bookings' 
      });
    }

    const car = await Car.findByIdAndDelete(req.params.id);

    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    res.json({ message: 'Car deleted successfully' });
  } catch (error) {
    console.error('Delete car error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid car ID' });
    }
    res.status(500).json({ message: 'Server error while deleting car' });
  }
});

// Get all bookings for admin
router.get('/bookings', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status, startDate, endDate } = req.query;

    let filter = {};
    if (status) {
      filter.status = status;
    }
    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const bookings = await Booking.find(filter)
      .populate('user', 'name email phone')
      .populate('car', 'title brand model image')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(filter);

    res.json({
      bookings,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalBookings: total,
        hasNext: skip + bookings.length < total,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Get admin bookings error:', error);
    res.status(500).json({ message: 'Server error while fetching bookings' });
  }
});

// Update booking status
router.patch('/bookings/:id/status', adminAuth, [
  body('status').isIn(['pending', 'confirmed', 'cancelled', 'completed']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status } = req.body;
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate('user', 'name email').populate('car', 'title brand model');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    res.json({
      message: 'Booking status updated successfully',
      booking
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({ message: 'Server error while updating booking status' });
  }
});

// Get all cars for admin
router.get('/cars', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, isAvailable } = req.query;

    let filter = {};
    if (search) {
      filter.$text = { $search: search };
    }
    if (isAvailable !== undefined) {
      filter.isAvailable = isAvailable === 'true';
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const cars = await Car.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Car.countDocuments(filter);

    res.json({
      cars,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCars: total,
        hasNext: skip + cars.length < total,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Get admin cars error:', error);
    res.status(500).json({ message: 'Server error while fetching cars' });
  }
});

module.exports = router;
