// Phase 1: Worker stub
// The assets binding will serve public/index.html automatically for GET /
// This stub handles non-asset paths (like /api/commentary in future phases)

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    
    // Non-asset path - return 404
    // In Phase 3, this will handle /api/commentary
    return new Response('Not found', { status: 404 });
  }
};
