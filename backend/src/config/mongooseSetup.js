const mongoose = require('mongoose');

/**
 * Must be required before any model files are loaded so update validators run.
 */
if (!mongoose.__vitalUpdateValidatorsPlugin) {
  mongoose.plugin((schema) => {
    schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function enableUpdateValidators() {
      this.setOptions({ runValidators: true });
    });
  });
  mongoose.__vitalUpdateValidatorsPlugin = true;
}

module.exports = mongoose;
