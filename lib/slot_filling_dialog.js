// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const Codegen = require('./codegen');
const ContactSearchDialog = require('./contact_search_dialog');
const UserContextDialog = require('./user_context_dialog');
const Helpers = require('./helpers');

module.exports = class SlotFillingDialog extends Dialog {
    constructor(slots, prefilled, fillAll, mustFill, scope, icon) {
        super();

        this.slots = slots;
        this.values = new Array(slots.length);
        this.comparisons = [];
        this.toFill = [];
        this.toConcretize = [];

        this.icon = icon;
        this._resolving = null;
        this._aux = null;

        Codegen.assignSlots(slots, prefilled, this.values, this.comparisons, fillAll, mustFill, scope, this.toFill);

        for (var i = 0; i < this.values.length; i++) {
            if (this.values[i] !== undefined && this.values[i].isVarRef)
                this.toConcretize.push(i);
        }
    }

    static slotFill(parent, obj, fillAll, mustFill, scope) {
        if (obj.resolved_args !== null)
            return Q(false);

        // if we get here, either we never pushed the SlotFillingDialog,
        // or the SlotFillingDialog returned false from .handle(), which
        // implies it is done
        if (parent.subdialog === null) {
            // make up slots
            var slots = obj.schema.schema.map(function(type, i) {
                return { name: obj.schema.args[i],
                         canonical: obj.schema.argcanonicals[i],
                         type: type,
                         question: obj.schema.questions[i],
                         required: (obj.schema.required[i] || false) };
            });
            var icon = Helpers.getIcon(obj);
            parent.push(new SlotFillingDialog(slots, obj.args, fillAll, mustFill, scope, icon));
            return Q(parent.subdialog.continue()).then((waiting) => {
                if (waiting) {
                    return waiting;
                } else {
                    obj.resolved_args = parent.subdialog.values;
                    obj.resolved_conditions = parent.subdialog.comparisons;
                    parent.pop();
                    return false;
                }
            });
        } else {
            obj.resolved_args = parent.subdialog.values;
            obj.resolved_conditions = parent.subdialog.comparisons;
            parent.pop();
            return Q(false);
        }
    }

    _concretize(index) {
        var value = this.values[index];
        if (value === undefined || !value.isVarRef)
            return Q(false);

        var name = value.name;
        if (name.startsWith('$contact('))
            return ContactSearchDialog.resolve(this, this.slots[index].type, this.values, index);
        else if (name.startsWith('$context'))
            return UserContextDialog.resolve(this, this.values, index);
        else
            return Q(false);
    }

    _askFeed(question) {
        var messaging = this.manager.messaging;
        if (!messaging.isAvailable) {
            this.reply(this._("Messaging is not available, cannot choose a feed."));
            return this.switchToDefault();
        }

        return Helpers.getFeedList(this, this.manager.messaging).then((feeds) => {
            this._aux = [];
            this.ask(ValueCategory.MultipleChoice, question);
            feeds.forEach((f, i) => {
                this._aux[i] = Ast.Value.Feed(this.manager.messaging.getFeed(f[1]));
                this.replyChoice(i, "feed", f[0]);
            });
            return true;
        });
    }

    _askEnum(entries, question) {
        this._aux = entries.map((e) => Ast.Value.Enum(e));
        this.ask(ValueCategory.MultipleChoice, question);
        entries.forEach((e, i) => {
            this.replyChoice(i, "choice", e);
        });
        return true;
    }

    continue() {
        if (this.toConcretize.length > 0) {
            var idx = this.toConcretize.shift();
            this._resolving = idx;

            return this._concretize(idx).then((waiting) => {
                if (waiting)
                    return waiting;
                else
                    return this.continue();
            });
        }

        if (this.toFill.length > 0) {
            var idx = this.toFill.shift();
            this._resolving = idx;

            var param = this.slots[idx];
            var question = param.question || this._("What is the value of argument %s?");

            if (param.type.isString)
                return this.ask(ValueCategory.RawString, question);
            else if (param.type.isMeasure)
                return this.ask(ValueCategory.Measure(param.type.unit), question);
            else if (param.type.isNumber)
                return this.ask(ValueCategory.Number, question);
            else if (param.type.isBoolean)
                return this.ask(ValueCategory.YesNo, question);
            else if (param.type.isDate)
                return this.ask(ValueCategory.Date, question);
            else if (param.type.isPicture)
                return this.ask(ValueCategory.Picture, question);
            else if (param.type.isLocation)
                return this.ask(ValueCategory.Location, question);
            else if (param.type.isFeed)
                return this._askFeed(question);
            else if (param.type.isEnum)
                return this._askEnum(param.type.entries, question);
            else if (param.type.isPhoneNumber)
                return this.ask(ValueCategory.PhoneNumber, question);
            else if (param.type.isEmailAddress)
                return this.ask(ValueCategory.EmailAddress, question);
            else
                throw new TypeError(); // can't handle it
        } else {
            return false;
        }
    }

    handleRaw(raw) {
        if (this._resolving !== null &&
            this.expecting === ValueCategory.RawString) {
            this.values[this._resolving] = Ast.Value.String(raw);
            this._resolving = null;
            return this.continue();
        } else {
            return super.handleRaw(raw);
        }
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this._resolving !== null) {
                if (this.expecting === ValueCategory.YesNo) {
                    if (command.isYes)
                        this.values[this._resolving] = Ast.Value.Boolean(true);
                    else
                        this.values[this._resolving] = Ast.Value.Boolean(false);
                    this._resolving = null;
                    return this.continue();
                } else {
                    if (this.expecting !== null) {
                        var value;
                        if (this.expecting === ValueCategory.MultipleChoice) {
                            var index = command.value;
                            if (index !== Math.floor(index) ||
                                index < 0 ||
                                index >= this._aux.length) {
                                this.reply(this._("Please click on one of the provided choices."));
                                return true;
                            } else {
                                value = this._aux[index];
                            }
                        } else {
                            value = command.value;
                        }
                        var givenType = Ast.typeForValue(value);
                        Type.typeUnify(this.slots[this._resolving].type, givenType);
                        this.values[this._resolving] = value;
                        this._aux = null;
                    }

                    if (!this.values[this._resolving].isVarRef) {
                        this._resolving = null;
                        return this.continue();
                    }

                    return this._concretize(this._resolving).then((waiting) => {
                        if (waiting) {
                            return waiting;
                        } else {
                            this._resolving = null;
                            return this.continue();
                        }
                    });
                }
            } else {
                return this.continue();
            }
        });
    }
}
