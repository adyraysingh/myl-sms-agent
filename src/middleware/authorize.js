'use strict';
/**
 * authorize middleware — Phase 1 Enterprise Security
 *
 * Role-Based Access Control (RBAC) guard.
 * Used AFTER authenticate middleware — req.user must already be set.
 *
 * Usage:
 *   router.get('/sensitive', authenticate, authorize(['ceo', 'sales_manager']), handler)
 *
 * Roles (in descending privilege order):
 *   ceo           — full read access + copilot + executive intelligence
 *   sales_manager — read all leads, decisions, investigations, operations
 *   sales_rep     — read own leads only, limited visibility
 *   system        — internal service-to-service calls only
 */

function authorize(allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    throw new Error('authorize() requires a non-empty array of allowed roles');
  }

  return function (req, res, next) {
    if (!req.user) {
      // authenticate middleware should have run first
      return res.status(401).json({ error: 'Unauthorized: no authenticated user' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden: insufficient role',
        required_roles: allowedRoles,
        your_role: req.user.role
      });
    }

    next();
  };
}

module.exports = { authorize };
