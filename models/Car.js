const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Car title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  brand: {
    type: String,
    required: [true, 'Brand is required'],
    trim: true
  },
  model: {
    type: String,
    required: [true, 'Model is required'],
    trim: true
  },
  year: {
    type: Number,
    required: [true, 'Year is required'],
    min: [1990, 'Year must be 1990 or later'],
    max: [new Date().getFullYear() + 1, 'Year cannot be in the future']
  },
  pricePerDay: {
    type: Number,
    required: [true, 'Price per day is required'],
    min: [0, 'Price cannot be negative']
  },
  pricePerHour: {
    type: Number,
    required: [true, 'Price per hour is required'],
    min: [0, 'Price cannot be negative']
  },
  fuelType: {
    type: String,
    required: [true, 'Fuel type is required'],
    enum: ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'CNG']
  },
  transmission: {
    type: String,
    required: [true, 'Transmission type is required'],
    enum: ['Manual', 'Automatic']
  },
  mileage: {
    type: Number,
    required: [true, 'Mileage is required'],
    min: [0, 'Mileage cannot be negative']
  },
  seats: {
    type: Number,
    required: [true, 'Number of seats is required'],
    min: [2, 'Minimum 2 seats required'],
    max: [8, 'Maximum 8 seats allowed']
  },
  image: {
    type: String,
    required: [true, 'Car image is required']
  },
  features: [{
    type: String,
    trim: true
  }],
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  location: {
    type: String,
    required: [true, 'Location is required'],
    trim: true
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalBookings: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for search functionality
carSchema.index({ title: 'text', brand: 'text', model: 'text' });
carSchema.index({ brand: 1, fuelType: 1, pricePerDay: 1 });

module.exports = mongoose.model('Car', carSchema);
