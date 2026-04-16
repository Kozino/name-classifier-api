const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v7: uuidv7 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// In-memory database (replace with real DB in production)
const profiles = new Map();

// Helper function to determine age group
function getAgeGroup(age) {
  if (age <= 12) return 'child';
  if (age <= 19) return 'teenager';
  if (age <= 59) return 'adult';
  return 'senior';
}

// Helper function to call external APIs
async function callExternalApis(name) {
  try {
    // Call all three APIs concurrently
    const [genderizeRes, agifyRes, nationalizeRes] = await Promise.all([
      axios.get(`https://api.genderize.io?name=${encodeURIComponent(name)}`),
      axios.get(`https://api.agify.io?name=${encodeURIComponent(name)}`),
      axios.get(`https://api.nationalize.io?name=${encodeURIComponent(name)}`)
    ]);

    // Validate Genderize response
    if (!genderizeRes.data.gender || genderizeRes.data.count === 0) {
      throw { api: 'Genderize', message: 'Invalid response' };
    }

    // Validate Agify response
    if (!agifyRes.data.age) {
      throw { api: 'Agify', message: 'Invalid response' };
    }

    // Validate Nationalize response
    if (!nationalizeRes.data.country || nationalizeRes.data.country.length === 0) {
      throw { api: 'Nationalize', message: 'Invalid response' };
    }

    // Get country with highest probability
    const topCountry = nationalizeRes.data.country.reduce((max, country) => 
      country.probability > max.probability ? country : max
    , nationalizeRes.data.country[0]);

    return {
      gender: genderizeRes.data.gender,
      gender_probability: genderizeRes.data.probability,
      sample_size: genderizeRes.data.count,
      age: agifyRes.data.age,
      age_group: getAgeGroup(agifyRes.data.age),
      country_id: topCountry.country_id,
      country_probability: topCountry.probability
    };
  } catch (error) {
    if (error.api) {
      throw error;
    }
    throw { api: 'External API', message: error.message };
  }
}

// 1. Create Profile POST /api/profiles
app.post('/api/profiles', async (req, res) => {
  try {
    const { name } = req.body;

    // Validate name
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        status: 'error',
        message: 'Missing or empty name'
      });
    }

    const trimmedName = name.trim().toLowerCase();
    
    // Check if profile already exists
    let existingProfile = null;
    for (const profile of profiles.values()) {
      if (profile.name === trimmedName) {
        existingProfile = profile;
        break;
      }
    }

    if (existingProfile) {
      return res.status(200).json({
        status: 'success',
        message: 'Profile already exists',
        data: existingProfile
      });
    }

    // Call external APIs
    const apiData = await callExternalApis(trimmedName);

    // Create new profile
    const newProfile = {
      id: uuidv7(),
      name: trimmedName,
      ...apiData,
      created_at: new Date().toISOString()
    };

    profiles.set(newProfile.id, newProfile);

    res.status(201).json({
      status: 'success',
      data: newProfile
    });
  } catch (error) {
    if (error.api) {
      return res.status(502).json({
        status: 'error',
        message: `${error.api} returned an invalid response`
      });
    }
    console.error('Unexpected error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// 2. Get Single Profile GET /api/profiles/{id}
app.get('/api/profiles/:id', (req, res) => {
  const { id } = req.params;
  const profile = profiles.get(id);

  if (!profile) {
    return res.status(404).json({
      status: 'error',
      message: 'Profile not found'
    });
  }

  res.status(200).json({
    status: 'success',
    data: profile
  });
});

// 3. Get All Profiles GET /api/profiles
app.get('/api/profiles', (req, res) => {
  let { gender, country_id, age_group } = req.query;
  
  let filteredProfiles = Array.from(profiles.values());
  
  // Apply filters (case-insensitive)
  if (gender) {
    const genderLower = gender.toLowerCase();
    filteredProfiles = filteredProfiles.filter(p => p.gender === genderLower);
  }
  
  if (country_id) {
    const countryUpper = country_id.toUpperCase();
    filteredProfiles = filteredProfiles.filter(p => p.country_id === countryUpper);
  }
  
  if (age_group) {
    const ageGroupLower = age_group.toLowerCase();
    filteredProfiles = filteredProfiles.filter(p => p.age_group === ageGroupLower);
  }
  
  // Return only specified fields
  const responseData = filteredProfiles.map(p => ({
    id: p.id,
    name: p.name,
    gender: p.gender,
    age: p.age,
    age_group: p.age_group,
    country_id: p.country_id
  }));
  
  res.status(200).json({
    status: 'success',
    count: responseData.length,
    data: responseData
  });
});

// 4. Delete Profile DELETE /api/profiles/{id}
app.delete('/api/profiles/:id', (req, res) => {
  const { id } = req.params;
  
  if (!profiles.has(id)) {
    return res.status(404).json({
      status: 'error',
      message: 'Profile not found'
    });
  }
  
  profiles.delete(id);
  res.status(204).send();
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;