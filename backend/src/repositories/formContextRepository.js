const FormContext = require('../models/formContextModel');

class FormContextRepository {
  async upsert(domain, formIdentifier, formUrl, fields) {
    return await FormContext.findOneAndUpdate(
      { domain, formIdentifier },
      { domain, formUrl, formIdentifier, fields },
      { upsert: true, new: true, runValidators: true }
    ).exec();
  }

  async findByDomainAndIdentifier(domain, formIdentifier) {
    return await FormContext.findOne({ domain, formIdentifier }).exec();
  }

  async findByDomain(domain) {
    return await FormContext.find({ domain }).exec();
  }

  async findById(id) {
    return await FormContext.findById(id).exec();
  }
}

module.exports = new FormContextRepository();
