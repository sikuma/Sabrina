// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Codegen = require('./codegen');
const CodegenDialog = require('./codegen_dialog');

module.exports = class TriggerDialog extends CodegenDialog {
    get CHANNEL_TYPE() {
        return 'triggers';
    }
    get slotFillAll() {
        return false;
    }

    describe() {
        return "notify if " + Codegen.describeTrigger(this.kind,
            this.channel,
            this.schema,
            this.resolved_args);
    }

    codegen() {
        return Codegen.codegenMonitor(this.manager.schemas, this);
    }

    prefix() {
        return 'Monitor';
    }
}