const express = require('express');

const router = express.Router();

const { thumbnailCache, getThumbnailHash } = require('../utils/thumbnail');

router.get('/:hash.:ext', (req, res) => {
  const { hash, ext } = req.params;

  let foundThumbnail = null;
  for (const [webdavPath, thumbnail] of thumbnailCache.entries()) {
    if (getThumbnailHash(webdavPath) === hash) {
      foundThumbnail = thumbnail;
      break;
    }
  }

  if (foundThumbnail && foundThumbnail.extension === ext) {
    res.setHeader('Content-Type', foundThumbnail.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(foundThumbnail.buffer);
  } else {
    res.status(404).json({ error: 'Thumbnail not found' });
  }
});

module.exports = router;

