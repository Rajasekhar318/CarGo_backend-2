const express = require('express');
const { body, validationResult } = require('express-validator');
const Booking = require('../models/Booking');
const Car = require('../models/Car');
const { auth } = require('../middleware/auth');
const Razorpay = require('razorpay');
const crypto = require('crypto'); // For signature verification

const router = express.Router();

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Helper function to calculate duration and total amount
const calculateBookingDetails = (car, startDate, endDate, startTime, endTime, bookingType) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let duration, totalAmount;

  if (bookingType === 'daily') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    duration = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    totalAmount = duration * car.pricePerDay;
  } else { // hourly
    const startDateTime = new Date(`${startDate}T${startTime}`);
    const endDateTime = new Date(`${endDate}T${endTime}`);
    duration = Math.ceil((endDateTime - startDateTime) / (1000 * 60 * 60));
    totalAmount = duration * car.pricePerHour;
  }
  return { duration, totalAmount };
};

// Create Razorpay Order
router.post('/create-razorpay-order', auth, [
  body('carId').isMongoId().withMessage('Invalid car ID'),
  body('startDate').isISO8601().withMessage('Start date must be a valid date'),
  body('endDate').isISO8601().withMessage('End date must be a valid date'),
  body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Start time must be in HH:MM format'),
  body('endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('End time must be in HH:MM format'),
  body('bookingType').isIn(['hourly', 'daily']).withMessage('Booking type must be hourly or daily'),
  body('pickupLocation').trim().isLength({ min: 1 }).withMessage('Pickup location is required'),
  body('dropoffLocation').trim().isLength({ min: 1 }).withMessage('Dropoff location is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      carId,
      startDate,
      endDate,
      startTime,
      endTime,
      bookingType,
    } = req.body;

    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    // Calculate amount based on booking details
    const { totalAmount } = calculateBookingDetails(car, startDate, endDate, startTime, endTime, bookingType);

    if (totalAmount <= 0) {
      return res.status(400).json({ message: 'Calculated total amount is zero or negative.' });
    }

    // Create Razorpay order
    const options = {
      amount: totalAmount * 100, // amount in smallest currency unit (e.g., paise)
      currency: 'INR',
      receipt: `receipt_order_${Date.now()}`,
      payment_capture: 1 // auto capture payment
    };

    const order = await razorpay.orders.create(options);

    res.status(200).json({
      orderId: order.id,
      currency: order.currency,
      amount: order.amount,
      key_id: process.env.RAZORPAY_KEY_ID,
      carTitle: car.title,
      userName: req.user.name,
      userEmail: req.user.email,
      userPhone: req.user.phone,
    });

  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ message: 'Server error while creating payment order' });
  }
});

// Verify Razorpay Payment and Create Booking
router.post('/verify-payment', auth, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingDetails // This will contain all original booking form data
    } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                                    .update(body.toString())
                                    .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: 'Payment verification failed: Invalid signature' });
    }

    // Signature is valid, proceed to create booking
    const {
      carId,
      startDate,
      endDate,
      startTime,
      endTime,
      bookingType,
      pickupLocation,
      dropoffLocation,
      specialRequests
    } = bookingDetails;

    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    if (!car.isAvailable) {
      return res.status(400).json({ message: 'Car is not available' });
    }

    // Re-check for overlapping bookings to prevent race conditions
    const startDateTimeForCheck = new Date(`${startDate}T${startTime}`);
    const endDateTimeForCheck = new Date(`${endDate}T${endTime}`);

    const overlappingBooking = await Booking.findOne({
      car: carId,
      status: { $in: ['confirmed', 'pending'] },
      $or: [
        {
          startDate: { $lte: endDateTimeForCheck },
          endDate: { $gte: startDateTimeForCheck }
        }
      ]
    });

    if (overlappingBooking) {
      return res.status(400).json({ message: 'Car is no longer available for the selected dates/times.' });
    }

    // Calculate duration and total amount again for final booking record
    const { duration, totalAmount } = calculateBookingDetails(car, startDate, endDate, startTime, endTime, bookingType);

    // Create booking with confirmed status and paid payment status
    const booking = new Booking({
      user: req.user._id,
      car: carId,
      startDate,
      endDate,
      startTime,
      endTime,
      totalAmount,
      bookingType,
      duration,
      pickupLocation,
      dropoffLocation,
      specialRequests,
      status: 'confirmed', // Confirmed after successful payment
      paymentStatus: 'paid',
      razorpayPaymentId: razorpay_payment_id, // Store payment ID
      razorpayOrderId: razorpay_order_id,     // Store order ID
    });

    await booking.save();

    // Update car's total bookings
    await Car.findByIdAndUpdate(carId, { $inc: { totalBookings: 1 } });

    // Populate car details for response
    await booking.populate('car', 'title brand model image pricePerDay pricePerHour');

    res.status(201).json({
      message: 'Booking created and payment successful!',
      booking
    });

  } catch (error) {
    console.error('Error verifying payment or creating booking:', error);
    res.status(500).json({ message: 'Server error during payment verification or booking creation' });
  }
});

// Get user bookings
router.get('/my-bookings', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    let filter = { user: req.user._id };
    if (status) {
      filter.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const bookings = await Booking.find(filter)
      .populate('car', 'title brand model image location')
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
    console.error('Get bookings error:', error);
    res.status(500).json({ message: 'Server error while fetching bookings' });
  }
});

// Get single booking
router.get('/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('car', 'title brand model image location pricePerDay pricePerHour')
      .populate('user', 'name email phone');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Check if user owns this booking or is admin
    if (booking.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(booking);
  } catch (error) {
    console.error('Get booking error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid booking ID' });
    }
    res.status(500).json({ message: 'Server error while fetching booking' });
  }
});

// Cancel booking
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Check if user owns this booking
    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if booking can be cancelled (before start date)
    const now = new Date();
    const startDate = new Date(booking.startDate);

    if (startDate <= now) {
      return res.status(400).json({ message: 'Cannot cancel booking that has already started' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ message: 'Booking is already cancelled' });
    }

    booking.status = 'cancelled';
    await booking.save();

    res.json({
      message: 'Booking cancelled successfully',
      booking
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ message: 'Server error while cancelling booking' });
  }
});

module.exports = router;
