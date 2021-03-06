// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Silei Xu <silei@stanford.edu>
//
// See COPYING for details
"use strict"

const Q = require('q');
const events = require('events');

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const Helpers = require('./helpers');

module.exports = class ListDialog extends Dialog {
    constructor() {
        super();
        this.listing = null;
    }

    start() {
        this.options = [ {
            label: this._("devices"),
            value: 'device',
        }, {
            label: this._("commands"),
            value: 'command'
        }];
    }

    _listCommands() {
        var devices = this.manager.devices.getAllDevices()
            .filter((d) => !d.hasKind('thingengine-system') && !d.hasKind('data-source'));
        if (devices.length === 0) {
            this.reply(this._("You don't have any device set up yet."));
            this.reply(this._("Try add some devices first."));
            return;
        }
        this.reply(this._("Here's what I can do for you."));
        var deviceSet = new Set();
        for (var i = 0; i < devices.length; ++i) {
            if (devices[i].globalName)
                deviceSet.add(devices[i].globalName);
            if (devices[i].constructor.metadata &&
                devices[i].constructor.metadata.types) {
                devices[i].constructor.metadata.types.forEach((t) => deviceSet.add(t));
            }
        }
        var typeArray = [];
        for (var type of deviceSet)
            typeArray.push(type);

        return this.manager.thingpedia.getExamplesByKinds(typeArray, true).then((examples) => {
            examples = Helpers.filterExamples(examples);
            return Helpers.augmentExamplesWithSlotTypes(this.manager.schemas, examples).then(() => {
                Helpers.presentExampleList(this, examples);
                return true;
            });
        });
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.listing === 'generic' &&
                this.expecting === ValueCategory.MultipleChoice) {
                this._handleResolve(command);
                return true;
            }

            this.listing = command.list;
            this._listContent();
            return true;
        });
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) || value < 0 || value > 2) {
            this.reply(this._("Please click on one of the provided choices."));
            return true;
        } else {
            this.listing = this.options[value].value;
            return this._listContent();
        }
    }

    _listDevices() {
        var devices = this.manager.devices.getAllDevices()
            .filter((d) => !d.hasKind('thingengine-system') && !d.hasKind('data-source'));
        if (devices.length === 0) {
            this.reply(this._("You don't have any device set up yet."));
        } else {
            this.reply(this._("You have the following devices:"));
            for (var i = 0; i < devices.length; ++i) {
                this.reply(devices[i].name, devices[i].kind);
            }
        }
        return this.switchToDefault();
    }

    _listContent() {
        switch (this.listing) {
            case 'device':
                return this._listDevices();
            case 'query':
            case 'command':
                return this._listCommands();
            default:
                this.ask(ValueCategory.MultipleChoice, this._("What do you want to me to list?"));
                for (var i = 0; i < this.options.length; ++i) {
                    this.replyChoice(i, "list", this.options[i].label);
                }
                return true;
        }
    }
}
