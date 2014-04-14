// robot.js - editing mode for robotframework pipe-separated text format

var robot = (function (self) {
    "use strict"; 

    function overlay_mode(config, parserConfig) {
        // This defines an overlay mode that matches robot 
        // variables (eg: ${...}. 
        var overlay = {
	    token: function(stream, state) {
	        var c;
                var brace_count;
	        if (stream.match("${")) {
                    brace_count = 1;
		    while ((c = stream.next()) != null) {
                        if (c === "{") {
                            brace_count += 1;
                        } else if (c === "}") {
                            brace_count -= 1;
                            if (brace_count <= 0) {break; }
                        }
                    }
		    return "variable";
	        }
                // skip to the next occurance of a variab
	        while (stream.next() != null && !stream.match("${", false)) {}
	        return null;
	    }
        };
        return overlay;
    };


    // this is the main mode for robot files
    function base_mode (config, parserConfig) {

        function eatCellContents(stream, state) {
            // gobble up characters until the end of the line or we find a separator

            var ch;

            while ((ch = stream.next()) != null) {
                if (ch === "\\") {
                    // escaped character; gobble up the following character
                    stream.next();

                } else if (ch == " ") {
                    // whitespace followed by pipe, then whitespace or EOL
                    // This signals the end of a cell in a row
                    if (stream.match(/\s*\|(\s+|$)/, false)) {
                        stream.backUp(1);
                        break;
                    }
                }
            }
            return (stream.current().length > 0);
        }

        function canonicalTableName(name) {
            // This returns the canonical name for a table, which will be
            // one of "settings", "test_cases", "keywords", or "variables"
            //
            // This function may return null if name isn't one of the
            // strings supported by robot
            name = name.trim().toLowerCase();
            if (name.match("settings?|metadata")) {return "settings"; } 
            if (name.match("(test )?cases?"))     {return "test_cases"; }
            if (name.match("(user )?keywords?"))  {return "keywords"; }
            if (name.match("variables?"))         {return "variables"; }
            return null;
        }

        function isHeading(stream, state) {
            // this matches things like "*** Test Cases ***", "*** Keywors ***", etc
            // It tries to strictly follow the robot specification, which implies you
            // can have more than one asterisk, and trailing asterisks are optional,
            // and the table names must be one of the recognized table names
            if (stream.sol()) {
                var match = stream.match(/^\s*\*+\s*(settings?|metadata|variables?|test( cases?)?|(user )?keywords?)[ *]*$/i);
                if (match !== null) {
                    state.table_name = canonicalTableName(match[1]);
                    stream.skipToEnd();
                    return true;
                }
            }
            return false;
        }

        function isContinuation(stream, state) {
            // Return true if the stream is currently in a 
            // continuation cell
            return (state.column === 1 && stream.current().trim() === "...");
        }

        function isSeparator(stream, state) {
            // Return true if the stream is currently in a separator
            var match = stream.match(/(^|\s+)\|(\s+|$)/)
            return match;
        }

        function isSetting(stream, state) {
            // Return true if the stream is in a settings table and the
            // token is a valid setting
            if (state.isSettingsTable() && state.column === 0) {
                var s = stream.current().trim().toLowerCase();
                if (s.match("^(library|resource|variables|documentation|metadata|" +
                            "suite setup|suite teardown|suite precondition|" +
                            "suite postcondition|force tags|default tags|test setup|" +
                            "test teardown|test precondition|test postcondition|" +
                            "test template|test timeout)$")) {
                    return true;
                }
            }
            return false;
        }

        function isLocalSetting(stream, state) {
            var s = stream.current().trim().toLowerCase();
            if (state.isTestCasesTable()) {
                if (s.match("\\[(documentation|tags|setup|teardown|precondition|postcondition|template|timeout)\\]")) {
                    return true;
                }
            } else if (state.isKeywordsTable()) {
                if (s.match("\\[(documentation|arguments|return|timeout)\\]")) {
                    return true;
                }
            }
            return false;
        }

        function isName(stream, state) {
            // Return true if this is column 0 in a test case or keyword table
            if (state.column === 0 && (state.isTestCasesTable() || state.isKeywordsTable())) {
                state.tc_or_kw_name = stream.current();
                console.log("name:", state.tc_or_kw_name);
                return true;
            }
            return false;
        }

        function isComment(stream, state) {
            // Return true if a cell begins with a hash (and optional leading whitesp
            if (stream.current().match("^\s*#")) {
                return true;
            }
            return false;
        }

        return {
            startState: function() {
                return {
                    table_name: null,
                    tc_or_kw_name: null,
                    column: -1,
                    isSettingsTable: function() {return (this.table_name === "settings"); },
                    isVariablesTable: function() {return (this.table_name === "variables"); },
                    isTestCasesTable: function() {return (this.table_name === "test_cases"); },
                    isKeywordsTable: function() {return (this.table_name === "keywords"); },
                }; 
            },

            token: function(stream, state) {

                // these are a crutch for me during development, so I can
                // see which styles have which colors
                if (stream.match(/builtin/)) {
                    return "builtin";
                } else if (stream.match(/keyword/)) {
                    return "keyword";
                } else if (stream.match(/header/)) {
                    return "header";
                } else if (stream.match(/tag/)) {
                    return "tag";
                } else if (stream.match(/meta/)) {
                    return "meta";
                } else if (stream.match(/atom/)) {
                    return "atom";
                } else if (stream.match(/variable/)) {
                    return "variable";
                } else if (stream.match(/attribute/)) {
                    return "attribute";
                } else if (stream.match(/string/)) {
                    return "string";
                } else if (stream.match(/comment/)) {
                    return "comment";
                }

                // comments at the start of a line
                if (stream.sol()) {
                    state.column = -1;
                    if (stream.match(/\s*#/)) {
                        stream.skipToEnd();
                        return "comment";
                    }
                }

                // table headings (eg: *** Test Cases ***)
                if (isHeading(stream, state)) {
                    return "header";
                }

                // yipes! pipes! 
                if (isSeparator(stream, state)) {
                    state.column += 1;
                    return "meta";
                }

                var c;
                if ((c=eatCellContents(stream, state))) {
                    // a table cell; it may be one of several flavors
                    if (isContinuation(stream, state)) {return "meta"; } 
                    if (isComment(stream, state))      {return "comment"; }
                    if (isLocalSetting(stream, state)) {return "builtin"; }
                    if (isSetting(stream, state))      {return "attribute"; }
                    if (isName(stream, state))         {return "keyword"; }
                }
                return null;
            }
        };

    }

    function rangeFinder(cm, start) {
	// find ranges that can be folded -- sections (settings, varibles, 
	// etc), keyword definitions and test case definitions

        // FIXME: stop at the last non-blank line of a block rather than the first
        // line of the next block 
        var startLine = cm.getLine(start.line);
	var endPattern = null;
	var state = cm.getStateAfter(start.line);

        var heading_pattern = /^\s*\*+\s*(settings?|metadata|variables?|test( cases?)?|(user )?keywords?)[ *]*$/i;
	var first_cell_pattern = /^\|\s+[a-z]/i;

	if (startLine.match(heading_pattern)) {
            // Found a heading? Everything up to the next heading or EOF 
            // is foldable region
	    endPattern = heading_pattern;

	} else if ((state.table_name == "test_cases" || 
		    state.table_name == "keywords") &&
		   startLine.match(first_cell_pattern)) {
            // The beginning of a test case or keyword? Fold up to 
            // the next test case, keyword, or heading (though,
            // we actually go to a line that is _probabaly_ a heading
            // to keep the pattern short)
            endPattern = new RegExp(/^\|\s+[^\|]|^\s*\*+/);

	} else {
	    // the current line is not a valid fold point...
	    return false;
	}

        for (var i = start.line + 1, end = cm.lineCount(); i < end; ++i) {
            var curLine = cm.getLine(i);
            if (curLine.match(endPattern)) {
		var result={
		    from: CodeMirror.Pos(start.line, startLine.length),
                    to: CodeMirror.Pos(i-1, curLine.length)
		};
		return result;
            };
        };
        // if we fell through the loop, fold to the end of the file
        return {from: CodeMirror.Pos(start.line, startLine.length),
                to: CodeMirror.Pos(i, curLine.length)}
    }


    function on_tab(cm) {
        // maybe-possibly insert a pipe, or move to the next
        // table cell. 
	//
	// blank line  : insert '| '
	// '| '        : replace with '| | ' if in a testcase or keyword
	// '| | '      : replace with '| | ... | ' 
	//
	// if at EOL, and line ends with space-pipe, remove the space-pipe,
	// insert a newline, and match the leading characters of the line

	var pos = cm.getCursor();
	var currentLine = cm.getLine(pos.line);

        // attempt to auto-indent; this will return true if it does
        // something which this block shouldn't mess with. 
	if (!auto_indent(cm, pos)) {
	    console.log("NOT autoindent");
	    // if we are at the end of the line and we're not preceeded by
	    // "| ", AND we're not in a table header, insert " | ".
            // Otherwise, move cursor to the next line. Or something like that.
            var token = cm.getTokenAt(pos);
            if (token.type != "header" && token.type != "comment") {
	        if (pos.ch == currentLine.length) { // cursor at eol
                    if (currentLine.match(/ +\|\s*$/)) {
                        // trailing empty cell; remove it and go to 
                        // the next line
	                var cursor = cm.getSearchCursor(/(\s+)\|\s*/, pos);
                        var match = cursor.findPrevious();
                        cursor.replace("");
			newline_and_indent(cm, pos);
                        return;
                    } else if (!currentLine.match(/ \|\s+$/)) {
		        cm.replaceRange(" | ", pos);
		        return;
		    } else {
			console.log("ouch.");
		    }
                }
            }
	    // all else fails, try moving to the next column
	    move_to_next_cell(cm, pos);
	}
    }

    function newline_and_indent(cm, pos) {
	// insert a newline, then match the indentation of the line
	var currentLine = cm.getLine(pos.line);
	var match = currentLine.match(/^([.|\s]+)/);
	if (match) {
	    cm.replaceRange("\n" + match[0], pos);
	} else {
	    cm.replaceRange("\n", pos);
	}
    }
    
    function auto_indent(cm, pos) {
	// attempt to insert an appropriate number of leading 
        // pipes on a line

	// FIXME: this code may be working too hard; in many cases
	// I probably should just insert whatever the previous
	// line has.

	var state = cm.getStateAfter(pos.line);
	var currentLine = cm.getLine(pos.line);

	if (currentLine === "") {
	    // blank line; insert "| "
	    cm.replaceRange("| ", pos)
	    return true;
	}
	if (currentLine.match(/^\|\s+$/)) {
            // one pipe and some spaces
            if (typeof state != "undefined") {
                if (state.isTestCasesTable() || state.isKeywordsTable()) {
                    // line begins with "| "; insert another space-pipe-space
		    cm.replaceRange("| | ", 
				    CodeMirror.Pos(pos.line, 0), 
				    CodeMirror.Pos(pos.line, currentLine.length));
		    return true;
	        } else {
                    // not a testcase or keyword table; insert a continuation line
		    cm.replaceRange("| ... | ",
				    CodeMirror.Pos(pos.line, 0), 
				    CodeMirror.Pos(pos.line, currentLine.length));
		    return true;
                }
	    }
	    return false;
	}
	if (currentLine.match(/^\|\s+\|\s+$/)) {
	    if (state.isTestCasesTable() || state.isKeywordsTable()) {
		// insert a testcase / keyword continuation
		cm.replaceRange("| | ... | ", 
				CodeMirror.Pos(pos.line, 0), 
				CodeMirror.Pos(pos.line, currentLine.length));
		return true;
	    }
	    return false;
	}
	return false; 
    }

    function move_to_next_cell(cm, pos) {
        // move the cursor to the first character in the next cell
	var cursor = cm.getSearchCursor(/(^|\s+)\|\s+/, pos);
	if (cursor.findNext()) {
	    cm.setCursor(cursor.to());
	}
    }
    

    function fold_all(cm) {
        var currentLine = null;
        for (var l = cm.firstLine(); l <= cm.lastLine(); ++l) {
            var token = cm.getTokenAt({line:l, ch: 1})
	        currentLine = cm.getLine(l);
                cm.foldCode({line: l, ch: 0}, null, "fold"); 
        }
    }

    self.overlay_mode = overlay_mode;
    self.base_mode = base_mode;
    self.rangeFinder = rangeFinder;
    self.on_tab = on_tab;
    return self

}(robot || {}));

CodeMirror.defineMode("robot-variable", robot.overlay_mode);
CodeMirror.defineMode("robot", robot.base_mode);
CodeMirror.defineMIME("text/x-robot", "robot");
CodeMirror.registerHelper("fold", "robot", robot.rangeFinder);
