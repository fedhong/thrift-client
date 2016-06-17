const thriftParser = require('thrift-parser');

class ThriftSchema {
  constructor(schema) {
    let result = thriftParser(schema);
    let { service } = result;
    if (!service) throw new Error('Service not found in schema');
    service = Object.keys(service).reduce((base, name) => Object.assign(base, service[name]), {});
    Object.assign(this, result, { service });
  }
  parseType(type) {
    let { typedef, struct, exception, enum: enumx } = this;
    while (typedef && type in typedef) type = typedef[type].type;
    if (enumx && type in enumx) type = 'I32';
    if ((struct && type in struct) || (exception && type in exception)) type = 'STRUCT';
    if (typeof type === 'string') type = type.toUpperCase();
    let thriftType = type;
    let plainType = String(type.name || type).toUpperCase();
    return { thriftType, plainType };
  }
  encodeStruct(schema, params) {
    let fields = schema.map(({ id, name, type }) => {
      if (!(name in params)) return void 0;
      let field = this.encodeValueWithType(params[name], type);
      field.id = +id;
      return field;
    }).filter(Boolean);
    return { fields };
  }
  encodeValueWithType(value, type) {
    let { plainType, thriftType }  = this.parseType(type);
    switch (plainType) {
      case 'BOOL':
      case 'BYTE':
      case 'I16':
      case 'I32':
      case 'I64':
      case 'DOUBLE':
      case 'STRING':
        return { type: plainType, value };
      case 'STRUCT': {
        let { struct = {}, exception = {} } = this;
        value = this.encodeStruct(struct[type] || exception[type], value);
        return { type: plainType, value };
      }
      case 'LIST': {
        let { valueType } = thriftType;
        let data = value.map(item => this.encodeValueWithType(item, valueType).value);
        valueType = this.parseType(valueType).plainType;
        return { type: 'LIST', value: { valueType, data } };
      }
      case 'MAP': {
        let { keyType, valueType } = thriftType;
        let data = Object.keys(value).map(k => {
          let v = value[k];
          let plainKeyType = this.parseType(keyType).plainType;
          if (plainKeyType === 'STRUCT' || keyType.name) k = JSON.parse(k);
          return {
            key: this.encodeValueWithType(k, keyType).value,
            value: this.encodeValueWithType(v, valueType).value
          };
        });
        keyType = this.parseType(keyType).plainType;
        valueType = this.parseType(valueType).plainType;
        return { type: 'MAP', value: { keyType, valueType, data } };
      } 
      default:
        throw new Error(`Error Type "${type}"`);
    }
  }
  decodeValueWithType(field, type) {
    let { plainType, thriftType }  = this.parseType(type);
    switch (plainType) {
      case 'BOOL':
      case 'BYTE':
      case 'I16':
      case 'I32':
      case 'I64':
      case 'DOUBLE':
      case 'STRING':
        return field.value;
      case 'STRUCT': {
        let sMap = {};
        field.value.fields.forEach(item => sMap[item.id] = item);
        let receiver = {};
        let { struct = {}, exception = {} } = this;
        (struct[type] || exception[type]).forEach(field => {
          let { id, type, name, option } = field;
          let value = sMap[id];
          if (option === 'required' && value === void 0) throw new Error(`Required field "${name}" not found`);
          if (value !== void 0) receiver[name] = this.decodeValueWithType(value, type);
        });
        return receiver;
      }
      case 'LIST':
        let { valueType } = thriftType;
        return field.value.data.map(item => this.decodeValueWithType({ value: item }, valueType));
      case 'MAP': {
        let { keyType, valueType } = thriftType;
        let receiver = {};
        field.value.data.forEach(({ key, value }) => {
          key = this.decodeValueWithType({ value: key }, keyType);
          value = this.decodeValueWithType({ value: value }, valueType);
          let plainKeyType = this.parseType(keyType).plainType;
          if (plainKeyType === 'STRUCT' || keyType.name) key = JSON.stringify(key);
          receiver[key] = value;
        });
        return receiver;
      }
      default:
        throw new Error(`Error Type ${JSON.stringify(type)}`);
    }
  }
}

module.exports = ThriftSchema;