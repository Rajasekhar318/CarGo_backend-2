const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  car: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Car',
    required: true
  },
  startDate: {
    type: Date,
    required: [true, 'Start date is required']
  },
  endDate: {
    type: Date,
    required: [true, 'End date is required']
  },
  startTime: {
    type: String,
    required: [true, 'Start time is required']
  },
  endTime: {
    type: String,
    required: [true, 'End time is required']
  },
  totalAmount: {
    type: Number,
    required: [true, 'Total amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  bookingType: {
    type: String,
    enum: ['hourly', 'daily'],
    required: true
  },
  duration: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  razorpayPaymentId: {
    type: String,
    required: false // Not required until payment is made
  },
  razorpayOrderId: {
    type: String,
    required: false // Not required until payment is made
  },
  pickupLocation: {
    type: String,
    required: [true, 'Pickup location is required']
  },
  dropoffLocation: {
    type: String,
    required: [true, 'Dropoff location is required']
  },
  specialRequests: {
    type: String,
    maxlength: [200, 'Special requests cannot exceed 200 characters']
  },
  bookingId: {
    type: String,
    unique: true,
    required: true
  }
}, {
  timestamps: true
});

// Generate booking ID before saving
bookingSchema.pre('save', function(next) {
  if (!this.bookingId) {
    this.bookingId = 'CG' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
  }
  next();
});

// Validate date range
bookingSchema.pre('save', function(next) {
  if (this.startDate >= this.endDate) {
    next(new Error('End date must be after start date'));
  }
  next();
});

module.exports = mongoose.model('Booking', bookingSchema);
