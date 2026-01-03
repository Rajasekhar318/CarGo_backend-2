const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Car = require('../models/Car');
const Booking = require('../models/Booking');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all cars with filters and search
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be non-negative'),
  query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be non-negative')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      page = 1,
      limit = 12,
      search,
      brand,
      fuelType,
      transmission,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      startDate,
      endDate
    } = req.query;

    // Build filter object
    let filter = { isAvailable: true };

    if (search) {
      filter.$text = { $search: search };
    }

    if (brand) {
      filter.brand = { $regex: brand, $options: 'i' };
    }

    if (fuelType) {
      filter.fuelType = fuelType;
    }

    if (transmission) {
      filter.transmission = transmission;
    }

    if (minPrice || maxPrice) {
      filter.pricePerDay = {};
      if (minPrice) filter.pricePerDay.$gte = parseFloat(minPrice);
      if (maxPrice) filter.pricePerDay.$lte = parseFloat(maxPrice);
    }

    // If date range is provided, exclude cars that are booked during that period
    if (startDate && endDate) {
      const bookedCarIds = await Booking.distinct('car', {
        status: { $in: ['confirmed', 'pending'] },
        $or: [
          {
            startDate: { $lte: new Date(endDate) },
            endDate: { $gte: new Date(startDate) }
          }
        ]
      });
      filter._id = { $nin: bookedCarIds };
    }

    // Build sort object
    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const cars = await Car.find(filter)
      .sort(sortObj)
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
    console.error('Get cars error:', error);
    res.status(500).json({ message: 'Server error while fetching cars' });
  }
});

// Get single car
router.get('/:id', async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    res.json(car);
  } catch (error) {
    console.error('Get car error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid car ID' });
    }
    res.status(500).json({ message: 'Server error while fetching car' });
  }
});

// Check car availability
router.post('/:id/check-availability', [
  body('startDate').isISO8601().withMessage('Start date must be a valid date'),
  body('endDate').isISO8601().withMessage('End date must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { startDate, endDate } = req.body;
    const carId = req.params.id;

    // Check if car exists
    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    // Check for overlapping bookings
    const overlappingBooking = await Booking.findOne({
      car: carId,
      status: { $in: ['confirmed', 'pending'] },
      $or: [
        {
          startDate: { $lte: new Date(endDate) },
          endDate: { $gte: new Date(startDate) }
        }
      ]
    });

    const isAvailable = !overlappingBooking && car.isAvailable;

    res.json({
      available: isAvailable,
      message: isAvailable ? 'Car is available for the selected dates' : 'Car is not available for the selected dates'
    });
  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({ message: 'Server error while checking availability' });
  }
});

// Get unique brands for filter
router.get('/filters/brands', async (req, res) => {
  try {
    const brands = await Car.distinct('brand', { isAvailable: true });
    res.json(brands.sort());
  } catch (error) {
    console.error('Get brands error:', error);
    res.status(500).json({ message: 'Server error while fetching brands' });
  }
});

module.exports = router;
