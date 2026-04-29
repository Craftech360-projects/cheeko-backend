/**
 * Authentication middleware for the separate onboarding database.
 */

const onboardingService = require('../services/onboarding.service');
const { unauthorized } = require('../utils/response');

const extractBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
};

const requireOnboardingAuth = async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return unauthorized(res, 'No onboarding token provided');
    }

    const user = await onboardingService.verifyToken(token);
    if (!user) {
      return unauthorized(res, 'Invalid or expired onboarding token');
    }

    req.onboardingUser = user;
    req.onboardingToken = token;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requireOnboardingAuth
};
